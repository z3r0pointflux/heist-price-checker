import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export async function takeScreenshot(): Promise<Buffer> {
  const tmpFile = path.join(os.tmpdir(), `heistchecker-${Date.now()}.png`);

  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('${tmpFile.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
$bmp.Dispose()
`.trim().replace(/\n/g, '; ');

  return new Promise((resolve, reject) => {
    exec(`powershell -NoProfile -Command "${psScript}"`, (err) => {
      if (err) {
        reject(err);
        return;
      }
      try {
        const buf = fs.readFileSync(tmpFile);
        fs.unlinkSync(tmpFile);
        resolve(buf);
      } catch (readErr) {
        reject(readErr);
      }
    });
  });
}
