// Replays every debug capture through the full detect -> OCR -> match -> price
// pipeline and checks it against the item that was actually on screen.
//
// Captures live outside the repo (%TEMP%\heistchecker-debug). When absent this
// exits 0 with a notice, so it never blocks a build on a machine without them.
const Module = require('module'), path = require('path'), os = require('os'), fs = require('fs');
const fud = path.join(os.tmpdir(), 'hc-corpus'); fs.mkdirSync(fud, { recursive: true });
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'electron' ? 'es' : orig.call(this, r, ...a); };
require.cache['es'] = { id: 'es', filename: 'es', loaded: true, exports: { app: { getPath: () => fud } } };

const DIST = path.join(__dirname, '..', 'dist', 'main');
const cfg = require(path.join(DIST, 'config'));
const pricing = require(path.join(DIST, 'pricing'));
const { classifyItem } = require(path.join(DIST, 'itemDetect'));
const ocr = require(path.join(DIST, 'ocr'));
const { detectHighlight } = require(path.join(DIST, 'highlight'));
const sharp = require('sharp');

// Prefer the preserved copy in the repo; %TEMP% gets cleaned and would take the
// corpus with it. Fall back to the live debug directory for fresh captures.
const FIXTURES = path.join(__dirname, 'fixtures');
const TEMP_DIR = path.join(os.tmpdir(), 'heistchecker-debug');
const DIR = fs.existsSync(FIXTURES) && fs.readdirSync(FIXTURES).some(f => f.startsWith('raw-'))
  ? FIXTURES
  : TEMP_DIR;

// What was actually on screen, read off the captures by eye.
const TRUTH = {
  '19-34-40': 'Vaal Rapier',
  '19-34-49': 'Replica Grip of the Council',
  '19-34-54': 'Replica Last Resort',
  '19-35-05': null,                       // heist rogue gear, not a curio item
  '19-35-12': 'Vaal Rapier',
  '19-48-48': 'Wraith Axe',
  '19-48-54': 'Wraith Axe',
  '20-03-06': 'Hussar Brigandine',
  '20-03-14': "Replica Victario's Charity",
  '20-03-19': 'Potentiality Rod',
  '20-03-24': 'Potentiality Rod',
  '20-03-30': 'Replica Gifts from Above',
  '20-03-35': 'Replica Tempestuous Steel',
  '20-03-41': 'Hussar Brigandine',
  '20-03-46': 'Hussar Brigandine',
  '20-23-47': 'Hussar Brigandine',
  '20-23-53': "Replica Victario's Charity",
  '20-23-59': null,                       // no tooltip on screen
  '20-24-06': 'Potentiality Rod',
  // 2026-08-06, in play. The Tailoring Orbs are the first currency captured:
  // one name line rather than two, and the name in tan rather than a rarity
  // colour, both of which the name-box detector originally missed.
  '19-15-45': null,                       // no tooltip on screen
  '19-15-51': 'Prophecy Wand',
  '19-15-56': "Replica Oro's Sacrifice",
  '19-16-03': "Tyrant's Sekhem",
  '19-28-30': 'Tailoring Orb',
  '19-28-36': 'Tailoring Orb',
  // 2026-08-07/08. The scarabs are the reason the exchange endpoint was found:
  // every one of these priced as null before, because poe.ninja serves scarabs
  // from economy/exchange/current, not economy/stash/{version}.
  '03-03-42': 'Banishing Blade',
  '03-12-18': 'Abyss Scarab of the Consort',
  '03-12-26': 'Abyss Scarab of the Consort',
  '01-33-32': 'Stabilising Sceptre',
  '02-07-56': 'Manifold Ring',
  // Clipped at the capture's left edge, so no name box is found and the match
  // has to come from the full-region pass — which is where a stat label
  // ("LIMIT") was beating the real name.
  '02-30-05': 'Kalguuran Scarab of Enriching',
  '02-30-11': 'Kalguuran Scarab of Enriching',
  '02-33-22': 'Trarthan Scarab of Renown',
  '02-33-28': 'Trarthan Scarab of Renown',
};

// Identifying an item is not the same as pricing it: the scarab bug produced a
// correct name and a null price for months. These keys must resolve to an actual
// number, so a regression in the fetch layer fails here rather than in play.
const MUST_PRICE = new Set([
  '03-12-18', '03-12-26', '02-30-05', '02-30-11', '02-33-22', '02-33-28',
  '19-28-30', '19-28-36',
]);

(async () => {
  if (!fs.existsSync(DIR)) {
    console.log('corpus captures not present — skipping (set HEISTCHECKER_DEBUG=1 to collect)');
    process.exit(0);
  }
  const files = fs.readdirSync(DIR).filter(f => f.startsWith('raw-')).sort();
  if (files.length === 0) {
    console.log('no raw-*.png captures — skipping');
    process.exit(0);
  }

  cfg.saveConfig({ hotkey: 'x', league: 'Allflame', overlayDismissMs: 5000, autoDismiss: true });
  await pricing.fetchPriceData();
  await ocr.initOCR();

  let pass = 0, fail = 0;
  for (const f of files) {
    const key = f.slice(15, 23);
    const want = TRUTH[key];
    if (want === undefined) continue;

    const buf = fs.readFileSync(path.join(DIR, f));
    const meta = await sharp(buf).metadata();
    // The capture IS the search region, so aim the cursor at its centre.
    const hl = await detectHighlight(buf, { x: Math.round(meta.width / 2), y: Math.round(meta.height / 2) });
    const res = await ocr.recognizeText(buf, hl.region, hl.nameBox);
    const info = classifyItem(res.lines, res.nameLines);

    const got = info.unidentified ? null : info.displayName;
    let ok = want === null ? got === null : got === want;

    // For the keys that must price, run the same lookup main.ts does.
    let priceNote = '';
    if (ok && MUST_PRICE.has(key)) {
      let range = null;
      const types = info.type === 'rare'
        ? ['BaseType']
        : pricing.STACKABLE_TYPES_LIST;
      for (const cat of types) {
        range = pricing.lookupPriceRange(info.searchTerm, cat);
        if (range) break;
      }
      if (range) {
        priceNote = `  [${range.minChaos}c ${range.itemType}]`;
      } else {
        ok = false;
        priceNote = '  [NO PRICE]';
      }
    }

    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${key}  ${String(want ?? '(no item)').padEnd(30)}` +
      `-> ${got ?? (info.noTooltip ? '(no tooltip)' : '(unidentified)')}${priceNote}`);
  }

  await ocr.shutdownOCR();
  console.log(`\n${fail === 0 ? 'ALL PASSED' : fail + ' FAILED'}  (${pass}/${pass + fail})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
