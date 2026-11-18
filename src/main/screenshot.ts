import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { screen, Point, Rectangle } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';

const runFile = promisify(execFile);

export interface ScreenshotCapture {
  buffer: Buffer;
  /** Physical desktop bounds of the captured display. */
  bounds: Rectangle;
  /** Cursor in image pixels, relative to the captured display. */
  cursor: Point;
}

/** Convert an OCR position back to Electron's desktop DIP coordinates. */
export function captureToScreenPoint(capture: ScreenshotCapture, point: Point): Point {
  // Keep an anchor beside a tooltip at the edge on the captured monitor.
  return screen.screenToDipPoint({
    x: capture.bounds.x + Math.max(0, Math.min(point.x, capture.bounds.width - 1)),
    y: capture.bounds.y + Math.max(0, Math.min(point.y, capture.bounds.height - 1)),
  });
}

export async function takeScreenshot(cursorPos: Point): Promise<ScreenshotCapture> {
  // Electron uses DIPs; CopyFromScreen and OCR use physical pixels. Convert the
  // whole display rectangle so negative origins and mixed DPI layouts work too.
  const display = screen.getDisplayNearestPoint(cursorPos);
  const bounds = screen.dipToScreenRect(null, display.bounds);
  const cursor = screen.dipToScreenPoint(cursorPos);
  const tmpFile = path.join(os.tmpdir(), `heistchecker-${randomUUID()}.png`);
  const quotedFile = tmpFile.replace(/'/g, "''");

  const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class CaptureDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[CaptureDpi]::SetProcessDPIAware() | Out-Null
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(${bounds.width}, ${bounds.height})
$gfx = $null
try {
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $gfx.CopyFromScreen(${bounds.x}, ${bounds.y}, 0, 0, $bmp.Size)
  $bmp.Save('${quotedFile}', [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  if ($null -ne $gfx) { $gfx.Dispose() }
  $bmp.Dispose()
}
`;

  try {
    // EncodedCommand preserves PowerShell variables, quotes and Unicode paths.
    // Hide the helper so a console window cannot steal focus from the game.
    await runFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(psScript, 'utf16le').toString('base64'),
    ], { windowsHide: true, timeout: 15000 });
    return {
      buffer: await fs.promises.readFile(tmpFile),
      bounds,
      cursor: { x: cursor.x - bounds.x, y: cursor.y - bounds.y },
    };
  } finally {
    await fs.promises.unlink(tmpFile).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }
}
