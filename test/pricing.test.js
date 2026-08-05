// Integration test: drives the real compiled pricing module against live poe.ninja.
const Module = require('module');
const path = require('path');
const os = require('os');

const fakeUserData = path.join(os.tmpdir(), 'heistchecker-itest');
require('fs').mkdirSync(fakeUserData, { recursive: true });

// Stub electron so config.ts can resolve a userData path.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === 'electron') return 'electron-stub';
  return origResolve.call(this, req, ...rest);
};
require.cache['electron-stub'] = {
  id: 'electron-stub',
  filename: 'electron-stub',
  loaded: true,
  exports: { app: { getPath: () => fakeUserData } },
};

const ROOT = require('path').join(__dirname,'..','dist','main');
const config = require(ROOT + '/config');
const pricing = require(ROOT + '/pricing');
const { classifyItem } = require(ROOT + '/itemDetect');

const ok = (c, m) => console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`);
let failures = 0;
const check = (c, m) => { if (!c) failures++; ok(c, m); };

(async () => {
  // --- 1. A user whose config still says "Mirage" (the 3.28 league) ---
  console.log('\n=== Case 1: config stuck on retired league "Mirage" ===');
  config.saveConfig({ hotkey: 'Ctrl+Shift+D', league: 'Mirage', overlayDismissMs: 5000, autoDismiss: true });
  await pricing.fetchPriceData();

  const st1 = pricing.getPriceDataStatus();
  console.log('  status:', JSON.stringify(st1));
  console.log('  config league is now:', config.getConfig().league);
  check(st1.state === 'league-retired', 'retired league is detected');
  check(st1.switchedTo === 'Allflame', 'auto-switched to current league (Allflame)');
  check(config.getConfig().league === 'Allflame', 'config was persisted with new league');
  check(pricing.hasPriceData(), 'prices were still loaded after the switch');

  // --- 2. Normal operation on the current league ---
  console.log('\n=== Case 2: current league (Allflame) ===');
  await pricing.fetchPriceData();
  const st2 = pricing.getPriceDataStatus();
  console.log('  status:', JSON.stringify(st2));
  check(st2.state === 'ok' && st2.itemCount > 10000, `loaded item data (${st2.itemCount} entries)`);

  // --- 3. Real heist lookups: the thing users actually do ---
  console.log('\n=== Case 3: heist item price lookups ===');
  const cases = [
    ['Cogwork Ring', 'BaseType', 'rare'],
    ['Disapprobation Axe', 'BaseType', 'rare'],
    ['Fugitive Boots', 'BaseType', 'rare'],
    ['Replica Abyssus', 'UniqueArmour', 'unique'],
    ['Divine Orb', 'Currency', 'currency'],
    ['Chaos Orb', 'Currency', 'currency'],
  ];
  for (const [name, type] of cases) {
    const r = pricing.lookupPriceRange(name, type);
    check(r !== null && r.minChaos > 0,
      `${name.padEnd(18)} -> ${r ? Math.round(r.minChaos) + 'c  (' + r.entries.length + ' variants, ' + r.entries.reduce((s, e) => s + e.listingCount, 0) + ' listings)' : 'NO PRICE'}`);
  }

  // --- 4. Currency listing counts (regression: they used to come back 0) ---
  console.log('\n=== Case 4: currency listingCount populated ===');
  const div = pricing.lookupPriceRange('Divine Orb', 'Currency');
  check(div && div.entries[0].listingCount > 0,
    `Divine Orb listingCount = ${div ? div.entries[0].listingCount : 'n/a'}`);

  // --- 5. Full OCR->price path with realistic (slightly garbled) OCR output ---
  console.log('\n=== Case 5: end-to-end from OCR text ===');
  const ocrCases = [
    [['Cogwork Ring'], 'rare'],
    [['Disapprobaticn Axe'], 'rare'],  // OCR garble
    [['Replica Abyssu5'], 'unique'],   // OCR garble
    [['Divine Orb'], 'currency'],
    [['Chaos Orb'], 'currency'],
  ];
  for (const [lines, expectType] of ocrCases) {
    const info = classifyItem(lines);
    let r = null;
    if (info.type === 'rare') r = pricing.lookupPriceRange(info.searchTerm, 'BaseType');
    else if (info.type === 'currency') {
      r = pricing.lookupPriceRange(info.searchTerm, 'Currency') || pricing.lookupPriceRange(info.searchTerm, 'Fragment');
    } else {
      for (const c of ['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel']) {
        r = pricing.lookupPriceRange(info.searchTerm, c);
        if (r) break;
      }
    }
    check(info.type === expectType && r !== null,
      `OCR ${JSON.stringify(lines)} -> ${info.type} "${info.displayName}" -> ${r ? Math.round(r.minChaos) + 'c' : 'NO PRICE'}`);
  }

  // --- 6. A league poe.ninja has never heard of ---
  console.log('\n=== Case 6: unknown league name ===');
  config.saveConfig({ ...config.getConfig(), league: 'NotARealLeague' });
  await pricing.fetchPriceData();
  const st6 = pricing.getPriceDataStatus();
  console.log('  status:', JSON.stringify(st6));
  check(st6.state === 'league-unknown' || st6.state === 'league-retired', 'unknown league reported, not silently empty');

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
