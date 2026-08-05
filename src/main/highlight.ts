import sharp from 'sharp';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

export async function detectHighlight(
  screenshotBuffer: Buffer,
  cursorPos: Point
): Promise<BoundingBox | null> {
  const image = sharp(screenshotBuffer);
  const metadata = await image.metadata();
  const imgWidth = metadata.width!;
  const imgHeight = metadata.height!;

  // This is a cursor-relative crop, not real tooltip detection: what lands in
  // frame shifts with the mouse, which is why two checks of the same item could
  // disagree. Widening it means the name is inside the window across a much
  // larger range of cursor positions and tooltip placements (PoE draws the
  // tooltip above or below the cursor depending on room on screen).
  const regionWidth = 760;
  const regionHeight = 420;

  // Centre horizontally, and bias upward since the item name sits at the top of
  // the tooltip — while still keeping headroom below for downward-drawn ones.
  const x = Math.max(0, Math.min(cursorPos.x - regionWidth / 2, imgWidth - regionWidth));
  const y = Math.max(0, Math.min(cursorPos.y - regionHeight * 0.6, imgHeight - regionHeight));

  const box: BoundingBox = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.min(regionWidth, imgWidth - Math.round(x)),
    height: Math.min(regionHeight, imgHeight - Math.round(y)),
  };

  console.log(`[highlight] Cursor region: (${box.x}, ${box.y}) ${box.width}x${box.height}`);
  return box;
}
