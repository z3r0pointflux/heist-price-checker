import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import { BoundingBox } from './highlight';

let worker: Tesseract.Worker | null = null;
// Startup kicks off initOCR() without awaiting it. A hotkey press during that
// window used to see `worker === null` and start a *second* Tesseract worker,
// leaking the first and making the press wait out a full engine init — which is
// why the first check after launch often did nothing and worked on the retry.
// Holding the in-flight promise makes concurrent callers share one init.
let initPromise: Promise<void> | null = null;

export function initOCR(): Promise<void> {
  if (worker) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const created = await Tesseract.createWorker('eng');
    await created.setParameters({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 '-,.",
      tessedit_pageseg_mode: '6',
    } as any);
    worker = created;
  })();

  // Let a failed init be retried instead of poisoning every later call.
  initPromise.catch(() => { initPromise = null; });

  return initPromise;
}

/** True once the OCR engine can serve a request without a cold start. */
export function isOCRReady(): boolean {
  return worker !== null;
}

/**
 * Tallest a single-line name box gets. Measured boxes fall in two clusters with
 * a wide gap: 46px for currency, 74–76px for a rare or unique carrying a base
 * type as well.
 */
const ONE_LINE_MAX_HEIGHT = 55;

export interface OcrResult {
  /** Lines read from the rarity-colour pass — these are item names. */
  nameLines: string[];
  /** Everything read, name pass first. */
  lines: string[];
}

/**
 * Isolate text drawn in PoE's item-rarity colours and return it as clean
 * black-on-white for Tesseract.
 *
 * Item names are drawn in the rarity colour (unique #af6025, rare #ffff77) on a
 * dark tooltip, which is almost no *luminance* contrast — greyscale OCR reads
 * the light grey stat lines and skips the name entirely. Keying on hue instead
 * recovers the name and drops every stat line at the same time.
 */
async function maskRarityColours(processed: Buffer, nameBoxOnly = false): Promise<Buffer> {
  const { data, info } = await sharp(processed).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const hit = new Uint8Array(width * height);
  let rarityHits = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const uniqueOrange = r > 110 && r < 250 && g > 45 && g < 155 && b < 95 && r > g * 1.5 && g > b * 1.1;
      const rareYellow = r > 185 && g > 185 && b < 165 && Math.abs(r - g) < 50;
      if (uniqueOrange || rareYellow) {
        hit[y * width + x] = 1;
        rarityHits++;
      }
    }
  }

  // Currency has no rarity colour: its name is a pale tan (#aa9e82 — measured at
  // (193,177,133), highlights to (242,234,209)), so the tests above keep almost
  // nothing and the name pass comes back empty. Read the tan instead, but only
  // once the rarity tests have come up empty, and only inside the name box:
  //
  //  - Applied to a rare or unique, this test also keeps the bright antialiased
  //    fringe around the coloured glyphs. That thickens every stroke until
  //    neighbouring letters merge, which is how "Replica Oro's Sacrifice" came
  //    back as "REPLCAOROSSACRIFICE" and matched its base type instead.
  //  - Applied to the whole region, it would keep every grey stat line — the
  //    exact failure the colour mask exists to prevent.
  //
  // Rarity coverage separates the two cases with room to spare: across 22
  // captured rare and unique name boxes it runs 3.5–10.3% of the crop, against
  // 0.49% for currency.
  const RARITY_TEXT_SHARE = 0.015;
  if (nameBoxOnly && rarityHits < width * height * RARITY_TEXT_SHARE) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * channels;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // The warmth floor (r - b) is what separates tan text from the neutral
        // grey of stat lines and the near-white of stack-size numerals.
        if (r > 140 && g > 125 && b > 90 && r >= g && g >= b && r - b > 15 && r - b < 110) {
          hit[y * width + x] = 1;
        }
      }
    }
  }

  // Scenery in the same hue — torch flame, the wooden "Curio Display" plaque —
  // survives the colour test as large solid masses and wrecks Tesseract's line
  // segmentation, which is what made an otherwise perfectly legible name come
  // back as gibberish. Glyph strokes are thin, so keep only pixels whose
  // neighbourhood is mostly empty and discard anything sitting inside a fill.
  //
  // Skipped for the name box: it contains nothing but the name, so text fills a
  // far larger share of the crop and this filter starts eating the text itself.
  if (nameBoxOnly) {
    const plain = Buffer.alloc(width * height, 255);
    for (let i = 0; i < width * height; i++) if (hit[i]) plain[i] = 0;
    return sharp(plain, { raw: { width, height, channels: 1 } }).png().toBuffer();
  }

  const integral = new Int32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += hit[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + rowSum;
    }
  }

  const RADIUS = 12;
  const MAX_LOCAL_COVERAGE = 0.55;
  const mask = Buffer.alloc(width * height, 255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!hit[y * width + x]) continue;
      const x0 = Math.max(0, x - RADIUS), y0 = Math.max(0, y - RADIUS);
      const x1 = Math.min(width - 1, x + RADIUS), y1 = Math.min(height - 1, y + RADIUS);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (width + 1) + x1 + 1] - integral[y0 * (width + 1) + x1 + 1] -
        integral[(y1 + 1) * (width + 1) + x0] + integral[y0 * (width + 1) + x0];
      if (sum / area < MAX_LOCAL_COVERAGE) mask[y * width + x] = 0;
    }
  }

  return sharp(mask, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

async function prepare(screenshotBuffer: Buffer, box: BoundingBox): Promise<Buffer> {
  return sharp(screenshotBuffer)
    .extract({ left: box.x, top: box.y, width: box.width, height: box.height })
    .resize(box.width * 3, box.height * 3, { kernel: 'lanczos3' })
    .sharpen()
    .png()
    .toBuffer();
}

export async function recognizeText(
  screenshotBuffer: Buffer,
  region: BoundingBox,
  nameBox: BoundingBox | null = null,
): Promise<OcrResult> {
  // Cheap when already initialised; blocks on the shared init when it isn't.
  await initOCR();

  // Previously this sliced 70px off each side "to avoid decorative borders",
  // which cut the first characters off item names — "Replica Quill Rain" reached
  // Tesseract as "EPLICA QUILL RAIN". The region is a plain screen crop with no
  // borders to trim, so read all of it and let the line filters drop noise.
  const cropX = region.x;
  const cropW = region.width;
  const cropH = region.height;

  // Minimal processing: just scale up 3x for better OCR resolution
  const cropped = await sharp(screenshotBuffer)
    .extract({ left: cropX, top: region.y, width: cropW, height: cropH })
    .resize(cropW * 3, cropH * 3, { kernel: 'lanczos3' })
    .sharpen()
    .png()
    .toBuffer();

  // Opt-in diagnostics: dump exactly what Tesseract was handed, so a bad read
  // can be traced to the crop rather than guessed at. Set HEISTCHECKER_DEBUG=1.
  if (process.env.HEISTCHECKER_DEBUG) {
    try {
      const fs = require('fs') as typeof import('fs');
      const os = require('os') as typeof import('os');
      const p = require('path') as typeof import('path');
      const dir = p.join(os.tmpdir(), 'heistchecker-debug');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(p.join(dir, `crop-${stamp}.png`), cropped);
      // Also keep the region at native resolution — the 3x copy cannot be fed
      // back through this function without being scaled twice, which makes
      // replaying a bad read impossible to do faithfully.
      await sharp(screenshotBuffer)
        .extract({ left: cropX, top: region.y, width: cropW, height: cropH })
        .png()
        .toFile(p.join(dir, `raw-${stamp}.png`));
      console.log(`[ocr] Debug crop written to ${dir}`);
    } catch (err) {
      console.warn('[ocr] Debug dump failed:', err);
    }
  }

  // Two passes: the colour mask finds the item name, the raw crop finds
  // everything else (stat lines are grey, which the mask deliberately discards).
  // When the name box was located, mask that band alone. It contains the item
  // name and nothing else, so the torch flame and the "Curio Display" plaque —
  // which are the same hue and previously had to be filtered out by density —
  // are never in the picture to begin with.
  const maskSource = nameBox ? await prepare(screenshotBuffer, nameBox) : cropped;
  const masked = await maskRarityColours(maskSource, nameBox !== null);
  if (process.env.HEISTCHECKER_DEBUG) {
    try {
      const fs = require('fs') as typeof import('fs');
      const os = require('os') as typeof import('os');
      const p = require('path') as typeof import('path');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(p.join(os.tmpdir(), 'heistchecker-debug', `mask-${stamp}.png`), masked);
    } catch {}
  }

  // Page segmentation is chosen per crop, because the two shapes of name box
  // want different modes and the box height says which one this is:
  //
  //  - Two lines (a name above a base type). psm 4 — a single column of varying
  //    sizes. Under psm 6 the words ran together and "Replica Oro's Sacrifice"
  //    came back as "REPUCAOROSSACRIFICE", priced as its base type.
  //  - One line (currency, scarabs). psm 6. psm 4 reads these as empty, which
  //    lost both Tailoring Orb captures when it was applied to every name box.
  //
  // Whole-region passes stay on 6, which is what they were tuned against.
  const namePsm = nameBox && nameBox.height > ONE_LINE_MAX_HEIGHT ? '4' : '6';
  if (namePsm !== '6') await worker!.setParameters({ tessedit_pageseg_mode: namePsm } as any);
  const nameRes = await worker!.recognize(masked);
  if (namePsm !== '6') await worker!.setParameters({ tessedit_pageseg_mode: '6' } as any);
  const fullRes = await worker!.recognize(cropped);
  const nameLines = cleanLines(nameRes.data.text.trim());
  const fullLines = cleanLines(fullRes.data.text.trim());

  console.log(`[ocr] Name-pass lines: ${JSON.stringify(nameLines)}`);
  console.log(`[ocr] Full-pass lines: ${JSON.stringify(fullLines)}`);

  // Name pass first so callers can trust order, de-duplicated.
  const seen = new Set<string>();
  const lines = [...nameLines, ...fullLines].filter(l => {
    const k = l.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { nameLines, lines };
}

function cleanLines(text: string): string[] {
  if (!text) return [];
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    // Strip leading/trailing non-alpha noise
    .map(line => line.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z]+$/, ''))
    // Remove trailing single characters (OCR artifacts like "g", "j")
    .map(line => line.replace(/\s+[A-Za-z]$/, ''))
    .filter(line => line.length > 2)
    // Filter noise: curio display variants
    .filter(line => !/disp.?lay/i.test(line))
    .filter(line => !/cur.{0,4}o/i.test(line) || line.length > 20)
    // Filter item description text (currency/flask descriptions)
    .filter(line => !/stack\s*size/i.test(line))
    .filter(line => !/removes?\s+(all\s+)?mod/i.test(line))
    .filter(line => !/right.click/i.test(line))
    .filter(line => !/upgrades?\s+a\s/i.test(line))
    .filter(line => !/reforges?\s/i.test(line))
    .filter(line => !/modifiers?\s+(from|to|on)\s/i.test(line))
    // Drop stat/affix lines. "Armour: 67" reduces to "Armour", which fuzzy-matched
    // the currency "Armourer's Scrap" almost perfectly and beat the real name.
    .filter(line => !STAT_LINE.test(line))
    // Filter lines that are mostly non-alpha (border artifacts)
    .filter(line => {
      const alphaCount = (line.match(/[A-Za-z]/g) || []).length;
      return alphaCount / line.length > 0.6;
    });
}

/** Tooltip stat and requirement text — never an item name. */
const STAT_LINE =
  /^(armour|evasion(\s+rating)?|energy\s*shield|physical\s+damage|elemental\s+damage|chance\s+to\s+block|critical\s+strike|attacks?\s+per\s+second|weapon\s+range|quality|requires?\b|level\b|one\s+handed|two\s+handed|increased|reduced|adds?\b|gain|socket)/i;

export async function shutdownOCR(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
  initPromise = null;
}
