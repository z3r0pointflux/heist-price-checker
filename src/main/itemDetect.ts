import { lookupCurrency } from './pricing';
import { EXPERIMENTED_BASES, REPLICA_UNIQUES } from './heistData';
import Fuse from 'fuse.js';

export interface ItemInfo {
  type: 'unique' | 'rare' | 'currency';
  searchTerm: string;
  displayName: string;
  baseName?: string;
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

export function classifyItem(lines: string[]): ItemInfo {
  if (lines.length === 0) {
    return { type: 'currency', searchTerm: '', displayName: 'Unknown' };
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

  // Fallback: try the longest line as currency
  const longest = [...lines].sort((a, b) => b.length - a.length)[0];
  return {
    type: 'currency',
    searchTerm: longest,
    displayName: longest,
  };
}
