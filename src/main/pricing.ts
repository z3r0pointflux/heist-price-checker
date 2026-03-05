import Fuse from 'fuse.js';
import { getConfig } from './config';

export interface PriceResult {
  name: string;
  chaosValue: number;
  divineValue: number;
  listingCount: number;
  icon?: string;
  itemType: string;
  variant?: string;
  links?: number;
}

export interface PriceRange {
  name: string;
  minChaos: number;
  maxChaos: number;
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
  receive?: { value: number };
  variant?: string;
  links?: number;
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

let allItems: PriceResult[] = [];
let uniqueNames: Set<string> = new Set();
let fuseIndex: Fuse<PriceResult> | null = null;
let lastFetchTime = 0;
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

export function getUniqueNames(): Set<string> {
  return uniqueNames;
}

export async function fetchPriceData(): Promise<void> {
  const league = getConfig().league;
  const items: PriceResult[] = [];
  const uniques = new Set<string>();

  console.log(`[pricing] Fetching poe.ninja data for league: ${league}`);

  // Fetch item overviews
  for (const type of ITEM_OVERVIEW_TYPES) {
    try {
      const url = `https://poe.ninja/api/data/itemoverview?league=${encodeURIComponent(league)}&type=${type}`;
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`[pricing] Failed to fetch ${type}: ${response.status}`);
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
          links: item.links,
        };
        items.push(priceResult);

        if (type.startsWith('Unique')) {
          uniques.add(item.name);
        }
      }
    } catch (err) {
      console.warn(`[pricing] Error fetching ${type}:`, err);
    }
  }

  // Fetch currency overviews
  for (const type of CURRENCY_OVERVIEW_TYPES) {
    try {
      const url = `https://poe.ninja/api/data/currencyoverview?league=${encodeURIComponent(league)}&type=${type}`;
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`[pricing] Failed to fetch ${type}: ${response.status}`);
        continue;
      }
      const data = await response.json();
      const lines: NinjaItem[] = data.lines || [];

      for (const item of lines) {
        const chaos = item.chaosEquivalent ?? item.receive?.value ?? 0;
        const priceResult: PriceResult = {
          name: item.currencyTypeName ?? (item as any).name ?? '',
          chaosValue: chaos,
          divineValue: 0, // Currency doesn't have divine value from API
          listingCount: item.count ?? item.listingCount ?? 0,
          icon: item.icon,
          itemType: type,
        };
        items.push(priceResult);
      }
    } catch (err) {
      console.warn(`[pricing] Error fetching ${type}:`, err);
    }
  }

  allItems = items;
  uniqueNames = uniques;
  lastFetchTime = Date.now();
  baseTypeFuse = null; // Reset cached index
  currencyFuse = null;

  // Build Fuse.js index
  fuseIndex = new Fuse(allItems, {
    keys: ['name'],
    threshold: 0.35,
    distance: 100,
  });

  console.log(`[pricing] Cached ${allItems.length} items, ${uniques.size} unique names`);
}

export function lookupPrice(searchTerm: string): PriceResult | null {
  if (!fuseIndex || allItems.length === 0) return null;

  const results = fuseIndex.search(searchTerm);
  if (results.length === 0) return null;

  return results[0].item;
}

const INFLUENCE_KEYWORDS = ['shaper', 'elder', 'hunter', 'warlord', 'redeemer', 'crusader'];

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

  const chaosValues = matches.map(m => m.chaosValue).filter(v => v > 0);
  if (chaosValues.length === 0) return null;

  return {
    name: matches[0].name,
    minChaos: Math.min(...chaosValues),
    maxChaos: Math.max(...chaosValues),
    entries: matches.sort((a, b) => a.chaosValue - b.chaosValue),
    icon: matches[0].icon,
    itemType: matches[0].itemType,
  };
}

let baseTypeFuse: Fuse<PriceResult> | null = null;
let currencyFuse: Fuse<PriceResult> | null = null;

export function lookupCurrency(searchTerm: string): { item: PriceResult; score: number } | null {
  if (allItems.length === 0) return null;

  if (!currencyFuse) {
    const currencyItems = allItems.filter(i => i.itemType === 'Currency' || i.itemType === 'Fragment');
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
