import Fuse from 'fuse.js';
import { getConfig, saveConfig } from './config';

export interface PriceResult {
  name: string;
  chaosValue: number;
  divineValue: number;
  listingCount: number;
  icon?: string;
  itemType: string;
  /** Influence for base types ("Shaper", "Elder/Warlord"), variant name for uniques. */
  variant?: string;
  /** Item level of a base type. This, not `variant`, is the ilvl breakdown. */
  levelRequired?: number;
  links?: number;
}

export interface PriceRange {
  name: string;
  /** Cheapest listing found — the headline price. */
  minChaos: number;
  /** Most expensive variant, for showing the spread. */
  maxChaos: number;
  /** Listing count behind minChaos, so thin data is visible rather than hidden. */
  lowestListings: number;
  /** Variant label (e.g. ilvl) the cheapest price came from, if any. */
  lowestLabel?: string;
  entries: PriceResult[];
  icon?: string;
  itemType: string;
}

interface NinjaItem {
  name: string;
  currencyTypeName?: string;
  chaosValue?: number;
  chaosEquivalent?: number;
  divineValue?: number;
  listingCount?: number;
  count?: number;
  icon?: string;
  receive?: { value: number; count?: number; listing_count?: number };
  variant?: string;
  levelRequired?: number;
  links?: number;
}

// poe.ninja retired the legacy /api/data/{item,currency}overview endpoints — they
// now return 404 for every league. The site is namespaced per game and every
// economy request is keyed to a rotating snapshot version that has to be read
// from index-state first.
const NINJA_BASE = 'https://poe.ninja/poe1/api';
const NINJA_HEADERS = { 'User-Agent': 'HeistChecker/1.2' };

/** A price row from the exchange endpoint. Names are not on the row itself. */
interface ExchangeLine {
  id: string;
  primaryValue?: number;
  volumePrimaryValue?: number;
}

/** The name/icon half of an exchange payload, joined to a line by `id`. */
interface ExchangeItem {
  id: string;
  name?: string;
  image?: string;
  category?: string;
}

interface NinjaLeague {
  name: string;
  url: string;
  displayName: string;
}

interface IndexState {
  economyLeagues: NinjaLeague[];
  oldEconomyLeagues: NinjaLeague[];
  snapshotVersions: { url: string; type: string; name: string; version: string }[];
}

const ITEM_OVERVIEW_TYPES = [
  'UniqueWeapon',
  'UniqueArmour',
  'UniqueAccessory',
  'UniqueFlask',
  'UniqueJewel',
  'BaseType',
];

const CURRENCY_OVERVIEW_TYPES = [
  'Currency',
  'Fragment',
];

/**
 * Categories served only by the exchange endpoint.
 *
 * These are not on `economy/stash/{version}/…` at all: `item/overview` returns a
 * bare 404 for every one of them, and `currency/overview` answers 200 with an
 * empty `lines` array for *any* type string — including nonsense — so neither
 * status code nor payload gave a hint that the request was misdirected. They
 * live under a separate path with the literal segment `current` where the stash
 * endpoints take a rotating snapshot version.
 *
 * Scarabs were the reported bug, but the same gap silently swallowed essences,
 * fossils, oils, divination cards, delirium orbs, omens, artifacts, resonators,
 * tattoos and allflame embers — roughly 750 further items a curio display can
 * hold, none of which could ever be priced.
 *
 * Currency and Fragment are deliberately absent: they are served here too, but
 * the stash endpoint carries real listing counts and this one does not, so they
 * stay on the richer source rather than being fetched twice.
 */
const EXCHANGE_OVERVIEW_TYPES = [
  'Scarab',
  'Essence',
  'Fossil',
  'Oil',
  'DivinationCard',
  'DeliriumOrb',
  'Omen',
  'Artifact',
  'Resonator',
  'Tattoo',
  'AllflameEmber',
];

let allItems: PriceResult[] = [];
let lastFetchTime = 0;
// Doubles as the background refresh interval and the staleness cutoff that
// ensureFreshCache() checks before a price lookup, so a price can be at most
// this old. poe.ninja serves rotating snapshots rather than live data, so
// fetching more often mostly re-downloads the same numbers.
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

export type PriceDataStatus =
  | { state: 'ok'; league: string; itemCount: number }
  | { state: 'empty'; league: string }
  | { state: 'league-retired'; league: string; switchedTo?: string }
  | { state: 'league-unknown'; league: string }
  | { state: 'network-error'; message: string }
  | { state: 'never-fetched' };

let status: PriceDataStatus = { state: 'never-fetched' };

export function getPriceDataStatus(): PriceDataStatus {
  return status;
}

export function hasPriceData(): boolean {
  return allItems.length > 0;
}

async function fetchIndexState(): Promise<IndexState> {
  const response = await fetch(`${NINJA_BASE}/data/index-state`, { headers: NINJA_HEADERS });
  if (!response.ok) {
    throw new Error(`index-state returned ${response.status}`);
  }
  return (await response.json()) as IndexState;
}

/** Fetch the list of leagues poe.ninja currently has economy data for. */
export async function fetchAvailableLeagues(): Promise<string[]> {
  const index = await fetchIndexState();
  return (index.economyLeagues ?? []).map(l => l.name);
}

interface ResolvedLeague {
  name: string;
  version: string;
}

/**
 * Map the configured league onto a league poe.ninja actually serves.
 *
 * The API matches on the league's display name ("Allflame"), not its url slug —
 * passing the slug returns HTTP 200 with an empty `lines` array, so a wrong name
 * looks like "no items priced" rather than an error. Matching is done
 * case-insensitively against both forms to absorb that.
 */
function resolveLeague(index: IndexState, configured: string): ResolvedLeague | null {
  const wanted = configured.trim().toLowerCase();
  const current = index.economyLeagues ?? [];

  const league = current.find(
    l => l.name.toLowerCase() === wanted || l.url.toLowerCase() === wanted,
  );
  if (!league) return null;

  // Snapshot versions are per-league-slug; 'exp' is the standard economy snapshot.
  // Some leagues (e.g. Hardcore) have no entry of their own — any current
  // snapshot works as the cache key, so fall back to the newest one we have.
  const versions = index.snapshotVersions ?? [];
  const own = versions.find(v => v.url === league.url && v.type === 'exp');
  const fallback = versions.find(v => v.type === 'exp');
  const version = own?.version ?? fallback?.version;
  if (!version) return null;

  return { name: league.name, version };
}

function isRetiredLeague(index: IndexState, configured: string): boolean {
  const wanted = configured.trim().toLowerCase();
  return (index.oldEconomyLeagues ?? []).some(
    l => l.name.toLowerCase() === wanted || l.url.toLowerCase() === wanted,
  );
}

export async function fetchPriceData(): Promise<void> {
  const configured = getConfig().league;

  let index: IndexState;
  try {
    index = await fetchIndexState();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[pricing] Could not reach poe.ninja:', message);
    status = { state: 'network-error', message };
    return;
  }

  let resolved = resolveLeague(index, configured);
  // Only set for the fetch that performs a migration, so the warning clears on
  // the next refresh instead of sticking to the session.
  let migration: PriceDataStatus | null = null;

  if (!resolved) {
    // A league that has rolled over stays in config forever and silently returns
    // no prices. Move the user onto the current challenge league instead.
    const currentLeague = (index.economyLeagues ?? [])[0];
    const retired = isRetiredLeague(index, configured);

    if (currentLeague) {
      console.warn(
        `[pricing] League "${configured}" is ${retired ? 'no longer active' : 'not on poe.ninja'} — ` +
          `switching to "${currentLeague.name}"`,
      );
      saveConfig({ ...getConfig(), league: currentLeague.name });
      resolved = resolveLeague(index, currentLeague.name);
      migration = retired
        ? { state: 'league-retired', league: configured, switchedTo: currentLeague.name }
        : { state: 'league-unknown', league: configured };
    }

    if (!resolved) {
      console.warn(`[pricing] No usable league for "${configured}"`);
      status = retired
        ? { state: 'league-retired', league: configured }
        : { state: 'league-unknown', league: configured };
      return;
    }
  }

  const { name: league, version } = resolved;
  const items: PriceResult[] = [];
  let failures = 0;

  console.log(`[pricing] Fetching poe.ninja data for league: ${league} (snapshot ${version})`);

  // Fetch item overviews
  for (const type of ITEM_OVERVIEW_TYPES) {
    try {
      const url =
        `${NINJA_BASE}/economy/stash/${encodeURIComponent(version)}/item/overview` +
        `?league=${encodeURIComponent(league)}&type=${type}`;
      const response = await fetch(url, { headers: NINJA_HEADERS });
      if (!response.ok) {
        console.warn(`[pricing] Failed to fetch ${type}: ${response.status}`);
        failures++;
        continue;
      }
      const data = await response.json();
      const lines: NinjaItem[] = data.lines || [];

      for (const item of lines) {
        const priceResult: PriceResult = {
          name: item.name,
          chaosValue: item.chaosValue ?? 0,
          divineValue: item.divineValue ?? 0,
          listingCount: item.listingCount ?? item.count ?? 0,
          icon: item.icon,
          itemType: type,
          variant: item.variant,
          levelRequired: item.levelRequired,
          links: item.links,
        };
        items.push(priceResult);
      }
    } catch (err) {
      console.warn(`[pricing] Error fetching ${type}:`, err);
      failures++;
    }
  }

  // Fetch currency overviews
  for (const type of CURRENCY_OVERVIEW_TYPES) {
    try {
      const url =
        `${NINJA_BASE}/economy/stash/${encodeURIComponent(version)}/currency/overview` +
        `?league=${encodeURIComponent(league)}&type=${type}`;
      const response = await fetch(url, { headers: NINJA_HEADERS });
      if (!response.ok) {
        console.warn(`[pricing] Failed to fetch ${type}: ${response.status}`);
        failures++;
        continue;
      }
      const data = await response.json();
      const lines: NinjaItem[] = data.lines || [];

      for (const item of lines) {
        const chaos = item.chaosEquivalent ?? item.receive?.value ?? 0;
        const priceResult: PriceResult = {
          name: item.currencyTypeName ?? (item as any).name ?? '',
          chaosValue: chaos,
          // Currency listing counts live on the `receive` block, not the top level.
          listingCount:
            item.receive?.listing_count ?? item.receive?.count ?? item.count ?? item.listingCount ?? 0,
          divineValue: 0, // Currency doesn't have divine value from API
          icon: item.icon,
          itemType: type,
        };
        items.push(priceResult);
      }
    } catch (err) {
      console.warn(`[pricing] Error fetching ${type}:`, err);
      failures++;
    }
  }

  // Fetch exchange overviews. Different path, different payload shape: prices
  // come back in `lines` keyed by a slug id, and the display names live in a
  // parallel `items` array that has to be joined on that id.
  for (const type of EXCHANGE_OVERVIEW_TYPES) {
    try {
      const url =
        `${NINJA_BASE}/economy/exchange/current/overview` +
        `?league=${encodeURIComponent(league)}&type=${type}`;
      const response = await fetch(url, { headers: NINJA_HEADERS });
      if (!response.ok) {
        console.warn(`[pricing] Failed to fetch ${type}: ${response.status}`);
        failures++;
        continue;
      }
      const data = await response.json();
      const lines: ExchangeLine[] = data.lines || [];
      const namesById = new Map<string, ExchangeItem>(
        (data.items || []).map((i: ExchangeItem) => [i.id, i]),
      );

      for (const line of lines) {
        const meta = namesById.get(line.id);
        // Without the join there is no display name to match OCR against, so a
        // row we cannot name is worth nothing to us.
        if (!meta?.name) continue;
        items.push({
          name: meta.name,
          chaosValue: line.primaryValue ?? 0,
          divineValue: 0,
          // This endpoint reports trade volume, not a listing count. Volume is a
          // different quantity, so it is not passed off as one — the overlay
          // simply omits the count for these rather than showing a wrong number.
          listingCount: 0,
          icon: meta.image ? `https://web.poecdn.com${meta.image}` : undefined,
          itemType: type,
        });
      }
    } catch (err) {
      console.warn(`[pricing] Error fetching ${type}:`, err);
      failures++;
    }
  }

  // Chaos Orb is the unit every other price is quoted in, so poe.ninja never
  // lists it. Curio displays do drop them, and without an entry it matches
  // nothing and shows no price — add it explicitly at its definitional value.
  if (items.some(i => i.itemType === 'Currency')) {
    items.push({
      name: 'Chaos Orb',
      chaosValue: 1,
      divineValue: 0,
      listingCount: 0,
      itemType: 'Currency',
    });
  }

  allItems = items;
  lastFetchTime = Date.now();
  baseTypeFuse = null; // Reset cached index
  currencyFuse = null;

  if (items.length === 0) {
    status = { state: 'empty', league };
  } else {
    status = migration ?? { state: 'ok', league, itemCount: items.length };
  }

  console.log(
    `[pricing] Cached ${allItems.length} items for ${league}` +
      (failures ? ` (${failures} overview(s) failed)` : ''),
  );
}

const INFLUENCE_KEYWORDS = ['shaper', 'elder', 'hunter', 'warlord', 'redeemer', 'crusader'];

/**
 * Label distinguishing one priced entry from another of the same item.
 *
 * For base types that is the item level, which poe.ninja returns as
 * `levelRequired` — `variant` carries the influence and is empty for the
 * uninfluenced bases heist curios drop, so keying off it showed no breakdown.
 */
export function variantLabel(entry: PriceResult): string | undefined {
  if (entry.itemType === 'BaseType') {
    return entry.levelRequired !== undefined ? String(entry.levelRequired) : entry.variant;
  }
  return entry.variant;
}

export function lookupPriceRange(name: string, itemType?: string): PriceRange | null {
  const nameLower = name.toLowerCase();
  let matches = allItems.filter(i => {
    if (i.name.toLowerCase() !== nameLower) return false;
    if (itemType && i.itemType !== itemType) return false;
    return true;
  });

  if (matches.length === 0) return null;

  // For base types: filter out influenced variants (heist items are uninfluenced)
  if (itemType === 'BaseType') {
    const uninfluenced = matches.filter(m =>
      !m.variant || !INFLUENCE_KEYWORDS.some(k => m.variant!.toLowerCase().includes(k))
    );
    if (uninfluenced.length > 0) matches = uninfluenced;
  }

  // For uniques: filter out linked variants (heist items aren't linked)
  if (!itemType || itemType?.startsWith('Unique')) {
    const unlinked = matches.filter(m => !m.links || m.links < 5);
    if (unlinked.length > 0) matches = unlinked;
  }

  const withPrice = matches.filter(m => m.chaosValue > 0);
  if (withPrice.length === 0) return null;

  // Report the cheapest listing on poe.ninja: for a curio display the question is
  // "what will this actually sell for", and the median across ilvl variants
  // overstated that. entries[0] is the headline price; the rest are the spread.
  const sorted = [...withPrice].sort((a, b) => a.chaosValue - b.chaosValue);
  const lowest = sorted[0];

  return {
    name: lowest.name,
    minChaos: lowest.chaosValue,
    maxChaos: sorted[sorted.length - 1].chaosValue,
    lowestListings: lowest.listingCount,
    lowestLabel: variantLabel(lowest),
    entries: sorted,
    icon: lowest.icon,
    itemType: lowest.itemType,
  };
}

let baseTypeFuse: Fuse<PriceResult> | null = null;
let currencyFuse: Fuse<PriceResult> | null = null;
let uniqueFuse: Fuse<PriceResult> | null = null;

const UNIQUE_TYPES = ['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel'];

/**
 * Types the item detector classifies as `currency` — i.e. anything stackable
 * that shows a one-line name box rather than a name plus base type. Derived from
 * the fetch lists so a category added there cannot be forgotten here; keeping
 * the two in sync by hand is what hid the scarab data even after it was cached.
 */
export const STACKABLE_TYPES_LIST = [...CURRENCY_OVERVIEW_TYPES, ...EXCHANGE_OVERVIEW_TYPES];
const STACKABLE_TYPES = new Set(STACKABLE_TYPES_LIST);

/**
 * Fuzzy-match against every unique poe.ninja prices, not just the replica list.
 * Curio displays mostly hold replicas, but a non-replica unique should still
 * resolve rather than falling through to the noise fallback.
 */
export function lookupUniqueName(searchTerm: string): { item: PriceResult; score: number } | null {
  if (allItems.length === 0) return null;

  if (!uniqueFuse) {
    // One entry per name — variants would otherwise crowd the ranking.
    const seen = new Set<string>();
    const uniques = allItems.filter(i => {
      if (!UNIQUE_TYPES.includes(i.itemType)) return false;
      const key = i.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    uniqueFuse = new Fuse(uniques, {
      keys: ['name'],
      threshold: 0.4,
      distance: 100,
      includeScore: true,
    });
  }

  const results = uniqueFuse.search(searchTerm);
  if (results.length === 0) return null;

  return { item: results[0].item, score: results[0].score ?? 1 };
}

export function lookupCurrency(searchTerm: string): { item: PriceResult; score: number } | null {
  if (allItems.length === 0) return null;

  if (!currencyFuse) {
    // Every stackable category the OCR path treats as "currency". Filtering on
    // Currency/Fragment alone left the exchange categories cached but
    // unreachable — the data would be in memory and still never match.
    const currencyItems = allItems.filter(i => STACKABLE_TYPES.has(i.itemType));
    currencyFuse = new Fuse(currencyItems, {
      keys: ['name'],
      threshold: 0.4,
      distance: 100,
      includeScore: true,
    });
  }

  const results = currencyFuse.search(searchTerm);
  if (results.length === 0) return null;

  return { item: results[0].item, score: results[0].score ?? 1 };
}

export function lookupBaseType(searchTerm: string): { item: PriceResult; score: number } | null {
  if (allItems.length === 0) return null;

  if (!baseTypeFuse) {
    const baseItems = allItems.filter(i => i.itemType === 'BaseType');
    baseTypeFuse = new Fuse(baseItems, {
      keys: ['name'],
      threshold: 0.4,
      distance: 100,
      includeScore: true,
    });
  }

  const results = baseTypeFuse.search(searchTerm);
  if (results.length === 0) return null;

  return { item: results[0].item, score: results[0].score ?? 1 };
}

export function isCacheStale(): boolean {
  return Date.now() - lastFetchTime > CACHE_DURATION_MS;
}

export async function ensureFreshCache(): Promise<void> {
  if (allItems.length === 0 || isCacheStale()) {
    await fetchPriceData();
  }
}

// Schedule periodic refresh
let refreshInterval: ReturnType<typeof setInterval> | null = null;

export function startPeriodicRefresh(): void {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(() => {
    fetchPriceData().catch(err => console.warn('[pricing] Refresh failed:', err));
  }, CACHE_DURATION_MS);
}

export function stopPeriodicRefresh(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}
