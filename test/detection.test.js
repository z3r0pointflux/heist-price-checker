// Every real OCR capture harvested from the user's heistchecker.log, with the
// item they were actually hovering. Guards against fixing one and breaking another.
const Module = require('module'), path = require('path'), os = require('os'), fs = require('fs');
const fud = path.join(os.tmpdir(), 'hc-reg'); fs.mkdirSync(fud, { recursive: true });
const o = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'electron' ? 'es' : o.call(this, r, ...a); };
require.cache['es'] = { id: 'es', filename: 'es', loaded: true, exports: { app: { getPath: () => fud } } };

const cfg = require(require('path').join(__dirname,'..','dist','main','config'));
const p = require(require('path').join(__dirname,'..','dist','main','pricing'));
const { classifyItem } = require('../dist/main/itemDetect');

// [label, nameLines, allLines, expectedName, expectedType]
const CASES = [
  ['rare axe (was Voidbringer)',
   ['Ne Fo VICTORY HUNGER Ii', 'Loe WRAITH AXE'],
   ['Ne Fo VICTORY HUNGER Ii', 'Loe WRAITH AXE', 'Pes 2 SE rad', 'IUNGER', 'ZA 4 E HANDED AXE',
    'hw HYSICAL DAMAGE', 'E TICAL STRIKE CHANCE', 'yi y ALES', 'i ATTACKS PER SECOND 1.64 RC Go'],
   'Wraith Axe', 'rare'],

  ['rare axe, 2nd press (same item)',
   ['hn F VICTORY HUNGER', 'oT WRAITH AXE'],
   ['hn F VICTORY HUNGER', 'oT WRAITH AXE', 'DD i Sl', 'j ps', 'IUNGER', "a 'H AXE", 'x E HANDED AXE',
    'oi HYSICAL DAMAGE', 'a TICAL STRIKE CHANCE'],
   'Wraith Axe', 'rare'],

  ['rare rapier',
   ['RUNE SAW', 'Le ge', 'VAAL RAPIER'],
   ['RUNE SAW', 'Le ge', 'VAAL RAPIER', 'SHE Va lS E21 FD', 'j REQUIRES LEVEL 66, 212 DEX'],
   'Vaal Rapier', 'rare'],

  ['replica unique',
   ['REPLICA HEATSHIVER', 'LleATHERHoOD'],
   ['REPLICA HEATSHIVER', 'LleATHERHoOD', 'EVASION RATING', 'REQUIRES LEVEL 20, 46 DEX'],
   'Replica Heatshiver', 'unique'],

  ['replica unique w/ OCR crumb',
   ['TT REPLICA GIFTS FROM ABOVE', 'DwawonbpRING'],
   ['TT REPLICA GIFTS FROM ABOVE', 'DwawonbpRING', 'REQUIRES LEVEL'],
   'Replica Gifts from Above', 'unique'],

  ['unique not in curated list',
   ['REPLICA VEIL OF THE NIGHT', 'GREAT HELMET'],
   ['BS ak fo', 'a nl', 'REPLICA VEIL OF THE NIGHT', 'GREAT HELMET', 'ARMOUR', 'ENERGY SHIELD'],
   'Replica Veil of the Night', 'unique'],

  ['non-heist base (was OCR noise)',
   [],
   ['TEMPEST SLAYER', 'ARMING AXE', 'ONE HANDED AXE', 'PHYSICAL DAMAGE', 'EC. Ll A NAR. Lo ONO'],
   'Arming Axe', 'rare'],

  ['known heist base',
   [], ['RUNE BITE', 'VOID FANGS', 'CLAW'], 'Void Fangs', 'rare'],

  ['short base name must survive cleanup',
   ['WAR AXE'], ['WAR AXE', 'ONE HANDED AXE'], 'War Axe', 'rare'],

  ['rare brigandine (was Stiletto)',
   ['KX TRIETT', 'Fo HYPNOTIC SANCTUARY', 'HUSSAR BRIGANDINE EN', 'iw Nn'],
   ['KX TRIETT', 'Fo HYPNOTIC SANCTUARY', 'HUSSAR BRIGANDINE EN', 'iw Nn',
    'i 5 BEINPNOTIC SANCTUARY', 'HUSSAR BRIGANDINE ily'],
   'Hussar Brigandine', 'rare'],
];

// Lines that must NEVER produce a confident item match.
const NOISE = [
  ['pure garbage', ['EC. Ll A NAR. Lo ONO', 'CG URIU IOP LAT J']],
  ['stat lines only', ['EVASION RATING', 'REQUIRES LEVEL 20, 46 DEX', 'INCREASED EVASION RATING']],
  ['fragment only', ['IUNGER']],
];

let fail = 0;
const ck = (c, m) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); };

(async () => {
  cfg.saveConfig({ hotkey: 'x', league: 'Allflame', overlayDismissMs: 5000, autoDismiss: true });
  await p.fetchPriceData();

  console.log('\n=== Real captures from your logs ===');
  for (const [label, nameLines, all, want, wantType] of CASES) {
    const r = classifyItem(all, nameLines);
    let price = null;
    if (r.type === 'rare') price = p.lookupPriceRange(r.searchTerm, 'BaseType');
    else if (r.type === 'currency') price = p.lookupPriceRange(r.searchTerm, 'Currency') || p.lookupPriceRange(r.searchTerm, 'Fragment');
    else for (const c of ['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel']) {
      price = p.lookupPriceRange(r.searchTerm, c); if (price) break;
    }
    ck(r.displayName === want && r.type === wantType,
      `${label.padEnd(34)} -> ${r.type} "${r.displayName}"${r.displayName === want ? '' : `  (want ${wantType} "${want}")`}${price ? '  ' + Math.round(price.minChaos) + 'c' : ''}`);
  }

  console.log('\n=== Noise must not be identified as an item ===');
  for (const [label, lines] of NOISE) {
    const r = classifyItem(lines, []);
    ck(r.unidentified === true, `${label.padEnd(34)} -> ${r.unidentified ? 'unidentified' : `WRONGLY matched "${r.displayName}"`}`);
  }

  console.log(`\n${fail === 0 ? 'ALL PASSED' : fail + ' FAILED'}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
