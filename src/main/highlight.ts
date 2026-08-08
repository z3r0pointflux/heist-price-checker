import sharp from 'sharp';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HighlightResult {
  /** Wide cursor-relative region, used as the OCR fallback. */
  region: BoundingBox;
  /**
   * The tooltip's name box, when found. Item name and base type live inside it,
   * and nothing else does — no stat lines, no scenery, no "Curio Display" plaque.
   */
  nameBox: BoundingBox | null;
}

interface Point {
  x: number;
  y: number;
}

// Search window around the cursor. Only used to bound the tooltip search; the
// name box is located within it by appearance, not by position.
const REGION_WIDTH = 760;
const REGION_HEIGHT = 420;

/**
 * A pixel belonging to the name box's horizontal rule.
 *
 * Rares are bordered in gold (~160,120,40) and uniques in a dimmer rust
 * (~136,80,40 fading to ~88,40,24), so the test spans both rather than keying on
 * brightness.
 */
function isBorderPixel(r: number, g: number, b: number): boolean {
  return r >= 80 && g >= 30 && g <= 180 && b <= 125 && r > b * 1.5 && r > g * 1.02;
}

/**
 * Height of the name box, measured across every captured tooltip.
 *
 * The box holds the item's name lines and nothing else, so its height follows
 * how many there are: rares and uniques print a name above a base type and
 * measure 68–70px, while currency prints a single line and measures ~39px.
 * Two narrow bands rather than one wide 33–80 window, because a wide one would
 * also admit a rule paired with a tooltip section separator below it.
 */
const NAME_BOX_BANDS: ReadonlyArray<readonly [number, number]> = [
  [33, 50], // one line — currency
  [60, 80], // two lines — rare, unique
];
/**
 * A rule spans most of the tooltip; letters and scenery do not.
 *
 * Currency draws the faintest rule measured — its upper one reaches only 0.455
 * of the width before breaking — so the bar has to sit below that or a currency
 * tooltip is left with a single rule and nothing to pair it with.
 */
const MIN_RULE_COVERAGE = 0.4;

/**
 * Locate the tooltip's name box inside an already-extracted region.
 *
 * Returns offsets relative to that region, or null when no tooltip is present —
 * which is a real answer, not a guess: a frame with no tooltip has no rule.
 */
function findNameBox(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
): { top: number; bottom: number; left: number; right: number } | null {
  // Longest unbroken horizontal run per row. Run length rather than pixel count
  // is what separates a rule from a row of letters: a rare's yellow name is warm
  // enough to match the colour test, but it is full of gaps.
  const border = new Uint8Array(width * height);
  const coverage: number[] = [];
  const runStart: number[] = [];
  const runEnd: number[] = [];
  for (let y = 0; y < height; y++) {
    let longest = 0;
    let current = 0;
    let end = -1;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (isBorderPixel(data[i], data[i + 1], data[i + 2])) {
        border[y * width + x] = 1;
        current++;
        if (current > longest) {
          longest = current;
          end = x;
        }
      } else {
        current = 0;
      }
    }
    coverage.push(longest / width);
    runStart.push(end - longest + 1);
    runEnd.push(end);
  }

  const rules: [number, number][] = [];
  let start: number | null = null;
  for (let y = 0; y < height; y++) {
    if (coverage[y] >= MIN_RULE_COVERAGE) {
      if (start === null) start = y;
    } else if (start !== null) {
      rules.push([start, y - 1]);
      start = null;
    }
  }
  if (start !== null) rules.push([start, height - 1]);

  const merged: [number, number][] = [];
  for (const rule of rules) {
    const prev = merged[merged.length - 1];
    if (prev && rule[0] - prev[1] <= 4) prev[1] = rule[1];
    else merged.push([...rule] as [number, number]);
  }

  // Any two rules the right distance apart, not necessarily adjacent — a rare's
  // name text sits between them and forms a run of its own.
  //
  // Widest band first, so a two-line box is never mistaken for a one-line one.
  // The name text between the rules is warm enough to clear the coverage bar in
  // its own right, which leaves a rare's *upper* rule and its name sitting about
  // one line apart — a false one-line box that cropped the base type out of
  // frame and cost four corpus cases when the narrow band was tried first.
  /** The row that carries a band's longest run, i.e. the rule itself. */
  const strongestRow = ([from, to]: [number, number]): number => {
    let best = from;
    for (let y = from; y <= to; y++) if (coverage[y] > coverage[best]) best = y;
    return best;
  };

  for (const [min, max] of [...NAME_BOX_BANDS].sort((a, b) => b[1] - a[1])) {
    for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const gap = merged[j][0] - merged[i][1];
        if (gap >= min && gap <= max) {
          const rowA = strongestRow(merged[i]);
          const rowB = strongestRow(merged[j]);
          const a = ruleExtent(border, width, rowA, runStart[rowA], runEnd[rowA]);
          const b = ruleExtent(border, width, rowB, runStart[rowB], runEnd[rowB]);
          return {
            top: merged[i][1],
            bottom: merged[j][0],
            left: Math.min(a[0], b[0]),
            right: Math.max(a[1], b[1]),
          };
        }
      }
    }
  }
  return null;
}

/**
 * A rule is capped at each end by a lock icon that breaks the colour run, so the
 * longest unbroken run stops short of the tooltip's true edge. Walk outward from
 * it and keep going across gaps small enough to be one of those caps.
 */
const MAX_RULE_GAP = 40;

function ruleExtent(
  border: Uint8Array,
  width: number,
  y: number,
  seedStart: number,
  seedEnd: number,
): [number, number] {
  const row = y * width;
  let left = seedStart;
  let right = seedEnd;
  // Growing outward from the run rather than taking the row's first and last
  // border pixel is what stops scenery of the same colour, sitting at the same
  // height but well clear of the tooltip, from dragging the edge out with it.
  for (let x = seedStart - 1, gap = 0; x >= 0; x--) {
    if (border[row + x]) { left = x; gap = 0; }
    else if (++gap > MAX_RULE_GAP) break;
  }
  for (let x = seedEnd + 1, gap = 0; x < width; x++) {
    if (border[row + x]) { right = x; gap = 0; }
    else if (++gap > MAX_RULE_GAP) break;
  }
  return [left, right];
}

export async function detectHighlight(
  screenshotBuffer: Buffer,
  cursorPos: Point,
): Promise<HighlightResult | null> {
  const image = sharp(screenshotBuffer);
  const metadata = await image.metadata();
  const imgWidth = metadata.width!;
  const imgHeight = metadata.height!;

  const x = Math.max(0, Math.min(cursorPos.x - REGION_WIDTH / 2, imgWidth - REGION_WIDTH));
  const y = Math.max(0, Math.min(cursorPos.y - REGION_HEIGHT * 0.6, imgHeight - REGION_HEIGHT));

  const region: BoundingBox = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.min(REGION_WIDTH, imgWidth - Math.round(x)),
    height: Math.min(REGION_HEIGHT, imgHeight - Math.round(y)),
  };

  const { data, info } = await sharp(screenshotBuffer)
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const found = findNameBox(data, info.width, info.height, info.channels);

  let nameBox: BoundingBox | null = null;
  if (found) {
    // A couple of pixels of padding keeps glyph tops and tails intact.
    const pad = 3;
    const top = Math.max(0, found.top - pad);
    const bottom = Math.min(region.height, found.bottom + pad);
    // Bound the box horizontally by the rules as well. Spanning the full search
    // width instead left torch flame sitting beside the tooltip inside the crop,
    // and since the density filter is skipped here it survived to break line
    // segmentation — "Replica Oro's Sacrifice" came back as one run-on word and
    // was priced as its base type.
    const left = Math.max(0, found.left - pad);
    const right = Math.min(region.width, found.right + pad);
    nameBox = {
      x: region.x + left,
      y: region.y + top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
    console.log(
      `[highlight] Name box at (${nameBox.x}, ${nameBox.y}) ${nameBox.width}x${nameBox.height}`);
  } else {
    console.log('[highlight] No tooltip name box found in region');
  }

  return { region, nameBox };
}
