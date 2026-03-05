import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import * as path from 'path';
import * as os from 'os';
import { BoundingBox } from './highlight';

let worker: Tesseract.Worker | null = null;

export async function initOCR(): Promise<void> {
  worker = await Tesseract.createWorker('eng');
  await worker.setParameters({
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 '-,.",
    tessedit_pageseg_mode: '6',
  } as any);
}

export async function recognizeText(
  screenshotBuffer: Buffer,
  region: BoundingBox
): Promise<string[]> {
  if (!worker) await initOCR();

  // Crop region, trimming sides to avoid decorative borders
  const trimX = 70;
  const cropX = Math.min(region.x + trimX, region.x + region.width - 1);
  const cropW = Math.max(1, region.width - trimX * 2);
  const cropH = region.height;

  // Minimal processing: just scale up 3x for better OCR resolution
  const cropped = await sharp(screenshotBuffer)
    .extract({ left: cropX, top: region.y, width: cropW, height: cropH })
    .resize(cropW * 3, cropH * 3, { kernel: 'lanczos3' })
    .sharpen()
    .png()
    .toBuffer();

  // Save debug images
  const ts = Date.now();
  const debugRawPath = path.join(os.tmpdir(), `heistchecker-debug-raw-${ts}.png`);
  const debugPath = path.join(os.tmpdir(), `heistchecker-debug-ocr-${ts}.png`);
  await sharp(screenshotBuffer)
    .extract({ left: cropX, top: region.y, width: cropW, height: cropH })
    .png().toFile(debugRawPath);
  await sharp(cropped).toFile(debugPath);
  console.log(`[ocr] Debug images saved: raw=${debugRawPath} processed=${debugPath}`);

  const result = await worker!.recognize(cropped);
  const text = result.data.text.trim();
  console.log(`[ocr] Raw OCR text: "${text}"`);

  if (!text) return [];

  const lines = text
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
    // Filter lines that are mostly non-alpha (border artifacts)
    .filter(line => {
      const alphaCount = (line.match(/[A-Za-z]/g) || []).length;
      return alphaCount / line.length > 0.6;
    });

  console.log(`[ocr] Filtered lines: ${JSON.stringify(lines)}`);
  return lines;
}

export async function shutdownOCR(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
