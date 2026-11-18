// Exercise capture -> tooltip detection -> overlay coordinates without a GUI.
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const childProcess = require('node:child_process');
const sharp = require('sharp');

let layout;
let image;
let failCapture = false;
let lastFile;
const stubScreen = {
  getDisplayNearestPoint: point => {
    assert.deepEqual(point, layout.cursor);
    return { bounds: layout.dip };
  },
  dipToScreenRect: (win, rect) => {
    assert.equal(win, null);
    assert.deepEqual(rect, layout.dip);
    return layout.physical;
  },
  dipToScreenPoint: p => ({
    x: layout.physical.x + (p.x - layout.dip.x) * layout.scale,
    y: layout.physical.y + (p.y - layout.dip.y) * layout.scale,
  }),
  screenToDipPoint: p => ({
    x: layout.dip.x + (p.x - layout.physical.x) / layout.scale,
    y: layout.dip.y + (p.y - layout.physical.y) / layout.scale,
  }),
};

const originalLoad = Module._load;
Module._load = function (name, ...args) {
  return name === 'electron' ? { screen: stubScreen } : originalLoad.call(this, name, ...args);
};
const originalExec = childProcess.execFile;
childProcess.execFile = (file, args, options, callback) => {
  assert.equal(file, 'powershell.exe');
  assert.equal(options.windowsHide, true);
  assert.equal(options.timeout, 15000);
  const script = Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
  assert.ok(script.includes(`$gfx.CopyFromScreen(${layout.physical.x}, ${layout.physical.y}, 0, 0, $bmp.Size)`));
  assert.ok(script.includes('SetProcessDPIAware()'));
  lastFile = script.match(/\$bmp.Save\('((?:[^']|'')+)'/)[1].replace(/''/g, "'");
  fs.writeFileSync(lastFile, image);
  process.nextTick(() => callback(failCapture ? new Error('capture failed') : null, '', ''));
};
const { takeScreenshot, captureToScreenPoint } = require('../dist/main/screenshot');
const { detectHighlight } = require('../dist/main/highlight');

(async () => {
  for (const [label, dip, physical, scale] of [
    ['primary', { x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1080 }, 1],
    ['left monitor', { x: -1920, y: 0, width: 1920, height: 1080 }, { x: -1920, y: 0, width: 1920, height: 1080 }, 1],
    ['125% right monitor', { x: 1920, y: 0, width: 1536, height: 864 }, { x: 1920, y: 0, width: 1920, height: 1080 }, 1.25],
    ['150% upper monitor', { x: 0, y: -720, width: 1280, height: 720 }, { x: 0, y: -1080, width: 1920, height: 1080 }, 1.5],
  ]) {
    layout = { dip, physical, scale, cursor: { x: dip.x + 600, y: dip.y + 400 } };
    const cursor = { x: 600 * scale, y: 400 * scale };
    // A tooltip name box in physical image pixels, within the cursor search.
    const left = cursor.x - 250;
    const top = cursor.y - 100;
    const pixels = Buffer.alloc(physical.width * physical.height * 3);
    for (const y of [top, top + 70]) {
      for (let x = left; x < left + 500; x++) {
        const i = (y * physical.width + x) * 3;
        pixels[i] = 160; pixels[i + 1] = 120; pixels[i + 2] = 40;
      }
    }
    image = await sharp(pixels, { raw: { width: physical.width, height: physical.height, channels: 3 } }).png().toBuffer();
    const capture = await takeScreenshot(layout.cursor);
    assert.deepEqual(capture.cursor, cursor);
    assert.deepEqual(capture.buffer, image);
    assert.equal(fs.existsSync(lastFile), false, 'temporary capture is removed');
    assert.deepEqual(captureToScreenPoint(capture, cursor), layout.cursor);
    const highlight = await detectHighlight(capture.buffer, capture.cursor);
    assert.ok(highlight.nameBox, `${label}: tooltip must be found`);
    const anchor = captureToScreenPoint(capture, highlight.nameBox);
    assert.ok(Math.abs(anchor.x - (dip.x + (left - 3) / scale)) < 1);
    assert.ok(Math.abs(anchor.y - (dip.y + (top - 3) / scale)) < 1);
    const edge = captureToScreenPoint(capture, { x: physical.width + 10, y: -20 });
    assert.ok(edge.x < dip.x + dip.width);
    assert.equal(edge.y, dip.y);
    console.log(`PASS  ${label}: capture, tooltip and overlay coordinates`);
  }
  failCapture = true;
  await assert.rejects(takeScreenshot(layout.cursor), /capture failed/);
  assert.equal(fs.existsSync(lastFile), false, 'failed captures are cleaned up');
  console.log('PASS  capture failure is propagated and temporary file removed');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
}).finally(() => {
  Module._load = originalLoad;
  childProcess.execFile = originalExec;
});
