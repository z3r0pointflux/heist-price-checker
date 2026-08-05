// Covers the two new asks: lowest-price lookup, and the OCR init race.
const Module = require('module');
const path = require('path');
const os = require('os');

const fakeUserData = path.join(os.tmpdir(), 'heistchecker-itest');
require('fs').mkdirSync(fakeUserData, { recursive: true });
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === 'electron') return 'electron-stub';
  return origResolve.call(this, req, ...rest);
};
require.cache['electron-stub'] = {
  id: 'electron-stub', filename: 'electron-stub', loaded: true,
  exports: { app: { getPath: () => fakeUserData } },
};

const ROOT = require('path').join(__dirname,'..','dist','main');
const config = require(ROOT + '/config');
const pricing = require(ROOT + '/pricing');

let failures = 0;
const check = (c, m) => { if (!c) failures++; console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); };

(async () => {
  config.saveConfig({ hotkey: 'Ctrl+Shift+D', league: 'Allflame', overlayDismissMs: 5000, autoDismiss: true });
  await pricing.fetchPriceData();

  console.log('\n=== Lowest price is reported, not median ===');
  // Independently recompute the expected lowest straight from the cached data.
  for (const [name, type] of [['Cogwork Ring', 'BaseType'], ['Fugitive Boots', 'BaseType'],
                              ['Disapprobation Axe', 'BaseType'], ['Simplex Amulet', 'BaseType']]) {
    const r = pricing.lookupPriceRange(name, type);
    const expected = Math.min(...r.entries.map(e => e.chaosValue));
    const median = (() => {
      const s = r.entries.map(e => e.chaosValue).sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    })();
    check(r.minChaos === expected,
      `${name.padEnd(20)} headline=${Math.round(r.minChaos)}c  (lowest=${Math.round(expected)}c, was-median=${Math.round(median)}c, max=${Math.round(r.maxChaos)}c)`);
  }

  console.log('\n=== Headline is the cheapest of all variants ===');
  const ring = pricing.lookupPriceRange('Cogwork Ring', 'BaseType');
  check(ring.entries[0].chaosValue === ring.minChaos, 'entries[0] is the cheapest variant');
  check(ring.entries.every(e => e.chaosValue >= ring.minChaos), 'no variant is cheaper than the headline');
  check(ring.minChaos <= ring.maxChaos, 'min <= max');
  check(typeof ring.lowestListings === 'number', `lowestListings surfaced (${ring.lowestListings})`);
  check(ring.lowestLabel !== undefined, `lowestLabel surfaced (ilvl ${ring.lowestLabel})`);

  console.log('\n=== Influenced variants still excluded from bases ===');
  check(ring.entries.every(e => !/shaper|elder|hunter|warlord|redeemer|crusader/i.test(e.variant || '')),
    'no influenced variant leaked into the cheapest set');

  console.log('\n=== OCR init race: concurrent calls share one worker ===');
  const ocr = require(ROOT + '/ocr');
  check(ocr.isOCRReady() === false, 'starts uninitialised');
  // Mimic startup firing init while a hotkey press races it.
  const a = ocr.initOCR();
  const b = ocr.initOCR();
  const c = ocr.initOCR();
  check(a === b && b === c, 'concurrent initOCR() calls share one in-flight promise (no duplicate workers)');
  await Promise.all([a, b, c]);
  check(ocr.isOCRReady() === true, 'worker ready after init resolves');
  const d = ocr.initOCR();
  check(d !== a, 'post-init call returns a resolved promise, not the old one');
  await d;
  await ocr.shutdownOCR();
  check(ocr.isOCRReady() === false, 'shutdown clears state so a later init can retry');

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
