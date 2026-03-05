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

  // Capture a region around the cursor where the item name should be.
  // In heist curio displays, item names appear at/below cursor level.
  const regionWidth = 500;
  const regionHeight = 180;

  // Center horizontally on cursor, extend well above cursor to catch full tooltip
  const x = Math.max(0, Math.min(cursorPos.x - regionWidth / 2, imgWidth - regionWidth));
  const y = Math.max(0, Math.min(cursorPos.y - 100, imgHeight - regionHeight));

  const box: BoundingBox = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.min(regionWidth, imgWidth - Math.round(x)),
    height: Math.min(regionHeight, imgHeight - Math.round(y)),
  };

  console.log(`[highlight] Cursor region: (${box.x}, ${box.y}) ${box.width}x${box.height}`);
  return box;
}
