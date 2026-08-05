import { lookupBaseType, lookupCurrency, lookupUniqueName } from './pricing';
import { EXPERIMENTED_BASES, REPLICA_UNIQUES } from './heistData';
import Fuse from 'fuse.js';

export interface ItemInfo {
  type: 'unique' | 'rare' | 'currency';
  searchTerm: string;
  displayName: string;
  baseName?: string;
  /** No item could be identified — the name shown is only a best guess. */
  unidentified?: boolean;
}

/**
 * How much a line looks like an item name rather than OCR noise.
 *
 * Garbage such as "EC. Ll A NAR. Lo ONO" used to win the fallback purely by
 * being the longest string, and got shown to the user as the item name.
 */
/**
 * Best curated-list or poe.ninja match across the given lines, or null.
 * Used for the rarity-colour name pass, where every line is a candidate name.
 */
function matchLines(lines: string[], label: string): ItemInfo | null {
  // Walk top-down and take the first line that resolves. A PoE tooltip prints
  // the item name above its base type, so scoring globally let an exact hit on
  // "Great Helmet" outrank the fuzzy hit on "Replica Veil of the Night" one line
  // above it — naming the base instead of the unique that carries the value.
  for (const line of lines) {
    if (line.replace(/[^A-Za-z]/g, '').length < 4) continue;
    if (plausibility(line) < 0.9) continue;

    let best: { type: 'unique' | 'rare'; match: string; score: number } | null = null;
    const consider = (type: 'unique' | 'rare', match: string | undefined, score: number | undefined, limit: number) => {
      if (!match || score === undefined || score >= limit) return;
      // Within one line prefer the unique reading: a replica's name and its base
      // both match something, and the name is what gets priced.
      if (!best || score < best.score || (type === 'unique' && best.type === 'rare' && score < limit)) {
        best = { type, match, score };
      }
    };

    const rep = replicaFuse.search(line)[0];
    consider('unique', rep?.item, rep?.score, 0.3);
    const uniq = lookupUniqueName(line);
    consider('unique', uniq?.item.name, uniq?.score, 0.35);
    if (!best) {
      const curated = baseFuse.search(line)[0];
      consider('rare', curated?.item, curated?.score, 0.3);
      const bt = lookupBaseType(line);
      consider('rare', bt?.item.name, bt?.score, 0.35);
    }

    if (best) {
      const hit = best as { type: 'unique' | 'rare'; match: string; score: number };
      console.log(`[itemDetect] ${label} matched "${hit.match}" (${hit.type}, score ${hit.score.toFixed(3)}) from "${line}"`);
      return {
        type: hit.type,
        searchTerm: hit.match,
        displayName: hit.match,
        ...(hit.type === 'rare' ? { baseName: hit.match } : {}),
      };
    }
  }
  return null;
}

function plausibility(line: string): number {
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;

  const alpha = (line.match(/[A-Za-z]/g) || []).length;
  const alphaRatio = alpha / line.length;
  // Real words contain vowels and are more than a stray letter or two.
  const wordly = words.filter(w => w.length >= 3 && /[aeiouAEIOU]/.test(w)).length / words.length;
  const punctuationPenalty = (line.match(/[.,]/g) || []).length / Math.max(1, words.length);

  return alphaRatio + wordly - punctuationPenalty;
}

// Pre-built Fuse indices for known heist items (tight thresholds)
const replicaFuse = new Fuse(REPLICA_UNIQUES, {
  threshold: 0.3,
  distance: 80,
  includeScore: true,
});

const baseFuse = new Fuse(EXPERIMENTED_BASES, {
  threshold: 0.3,
  distance: 80,
  includeScore: true,
});

export function classifyItem(lines: string[], nameLines: string[] = []): ItemInfo {
  if (lines.length === 0) {
    return { type: 'currency', searchTerm: '', displayName: 'Unknown' };
  }

  // Lines from the rarity-colour pass are item names by construction, so let
  // them settle it before anything read off the rest of the tooltip.
  if (nameLines.length > 0) {
    const fromName = matchLines(nameLines, 'Name pass');
    if (fromName) return fromName;
  }

  // Heist curio displays only contain 3 item types:
  // 1. Replica uniques (name like "Replica X")
  // 2. Experimented base types (rare items with known base names)
  // 3. Currency/fragments

  let bestReplica: { match: string; score: number; line: string } | null = null;
  let bestBase: { match: string; score: number; line: string } | null = null;
  let bestCurrency: { match: string; score: number; line: string } | null = null;

  for (const line of lines) {
    const alphaLen = line.replace(/[^A-Za-z]/g, '').length;
    if (alphaLen < 4) continue;

    // Try replica unique match
    if (alphaLen >= 6) {
      const replicaResults = replicaFuse.search(line);
      if (replicaResults.length > 0 && replicaResults[0].score !== undefined) {
        if (!bestReplica || replicaResults[0].score < bestReplica.score) {
          bestReplica = { match: replicaResults[0].item, score: replicaResults[0].score, line };
        }
      }
    }

    // Try experimented base match
    const baseResults = baseFuse.search(line);
    if (baseResults.length > 0 && baseResults[0].score !== undefined) {
      if (!bestBase || baseResults[0].score < bestBase.score) {
        bestBase = { match: baseResults[0].item, score: baseResults[0].score, line };
      }
    }

    // Try currency match (from poe.ninja data)
    const currencyResult = lookupCurrency(line);
    if (currencyResult) {
      if (!bestCurrency || currencyResult.score < bestCurrency.score) {
        bestCurrency = { match: currencyResult.item.name, score: currencyResult.score, line };
      }
    }
  }

  console.log(`[itemDetect] Best replica match: ${bestReplica ? `"${bestReplica.match}" (score: ${bestReplica.score.toFixed(3)}) from line "${bestReplica.line}"` : 'none'}`);
  console.log(`[itemDetect] Best base match: ${bestBase ? `"${bestBase.match}" (score: ${bestBase.score.toFixed(3)}) from line "${bestBase.line}"` : 'none'}`);
  console.log(`[itemDetect] Best currency match: ${bestCurrency ? `"${bestCurrency.match}" (score: ${bestCurrency.score.toFixed(3)}) from line "${bestCurrency.line}"` : 'none'}`);

  // Pick the best match across all categories
  type Match = { type: 'unique' | 'rare' | 'currency'; match: string; score: number };
  const candidates: Match[] = [];

  if (bestReplica && bestReplica.score < 0.3) {
    candidates.push({ type: 'unique', match: bestReplica.match, score: bestReplica.score });
  }
  if (bestBase && bestBase.score < 0.3) {
    candidates.push({ type: 'rare', match: bestBase.match, score: bestBase.score });
  }
  if (bestCurrency && bestCurrency.score < 0.3) {
    candidates.push({ type: 'currency', match: bestCurrency.match, score: bestCurrency.score });
  }

  // Sort by score (lowest = best match)
  candidates.sort((a, b) => a.score - b.score);

  if (candidates.length > 0) {
    const best = candidates[0];
    if (best.type === 'unique') {
      return {
        type: 'unique',
        searchTerm: best.match,
        displayName: best.match,
      };
    }
    if (best.type === 'rare') {
      return {
        type: 'rare',
        searchTerm: best.match,
        displayName: best.match,
        baseName: best.match,
      };
    }
    return {
      type: 'currency',
      searchTerm: best.match,
      displayName: best.match,
    };
  }

  // Nothing matched the curated heist lists. That does not mean the item is
  // unknown — a curio display can hold a base or unique outside those lists
  // (e.g. "Arming Axe"), so fall back to everything poe.ninja prices before
  // giving up. Thresholds stay loose here because the curated pass already had
  // first refusal.
  const fromAll = matchLines(lines, 'Full pass');
  if (fromAll) return fromAll;

  // Currency last: its names are ordinary words, so letting it compete earlier is
  // how a stat line reading "Armour" became "Armourer's Scrap".
  for (const line of lines) {
    if (plausibility(line) < 0.9) continue;
    const cur = lookupCurrency(line);
    if (cur && cur.score < 0.2) {
      console.log(`[itemDetect] Currency matched "${cur.item.name}" (score ${cur.score.toFixed(3)})`);
      return { type: 'currency', searchTerm: cur.item.name, displayName: cur.item.name };
    }
  }

  // Genuinely unrecognised. Show the most name-like line rather than whichever
  // string happened to be longest, and flag it so the overlay can say so.
  const best = [...lines].sort((a, b) => plausibility(b) - plausibility(a))[0] ?? '';
  console.log(`[itemDetect] No match; best-guess line "${best}"`);
  return {
    type: 'currency',
    searchTerm: best,
    displayName: best,
    unidentified: true,
  };
}
