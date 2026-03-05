import { getUniqueNames, lookupBaseType } from './pricing';
import Fuse from 'fuse.js';

export interface ItemInfo {
  type: 'unique' | 'rare' | 'currency';
  searchTerm: string;
  displayName: string;
  baseName?: string;
}

export function classifyItem(lines: string[]): ItemInfo {
  if (lines.length === 0) {
    return { type: 'currency', searchTerm: '', displayName: 'Unknown' };
  }

  // Try every line against the price database and pick the best match.
  // This avoids relying on line position which is unreliable due to OCR noise.
  const uniqueNames = getUniqueNames();
  let bestUnique: { line: string; match: string; score: number } | null = null;
  let bestBase: { line: string; match: string; score: number } | null = null;

  if (uniqueNames.size > 0) {
    const fuse = new Fuse(Array.from(uniqueNames), {
      threshold: 0.4,
      distance: 120,
      includeScore: true,
    });

    for (const line of lines) {
      // Skip short lines — they match too many uniques falsely (e.g. "Bow" → "Rainbowstride")
      if (line.replace(/[^A-Za-z]/g, '').length < 6) continue;
      const results = fuse.search(line);
      if (results.length > 0 && results[0].score !== undefined) {
        if (!bestUnique || results[0].score < bestUnique.score) {
          bestUnique = { line, match: results[0].item, score: results[0].score };
        }
      }
    }
  }

  // Also try each line as a base type lookup (dedicated base type index)
  for (const line of lines) {
    if (line.replace(/[^A-Za-z]/g, '').length < 4) continue;
    const result = lookupBaseType(line);
    if (result) {
      if (!bestBase || result.score < bestBase.score) {
        bestBase = { line, match: result.item.name, score: result.score };
      }
    }
  }

  console.log(`[itemDetect] Best unique match: ${bestUnique ? `"${bestUnique.match}" (score: ${bestUnique.score.toFixed(3)}) from line "${bestUnique.line}"` : 'none'}`);
  console.log(`[itemDetect] Best base match: ${bestBase ? `"${bestBase.match}" (score: ${bestBase.score.toFixed(3)}) from line "${bestBase.line}"` : 'none'}`);

  // If we have both a unique and base match from DIFFERENT lines,
  // the item is likely unique (unique name + base type on separate lines)
  if (bestUnique && bestBase && bestUnique.line !== bestBase.line && bestUnique.score < 0.4) {
    return {
      type: 'unique',
      searchTerm: bestUnique.match,
      displayName: bestUnique.match,
      baseName: bestBase.match,
    };
  }

  // Base type match — rare item (prefer this over loose unique matches)
  if (bestBase && bestBase.score < 0.2) {
    return {
      type: 'rare',
      searchTerm: bestBase.match,
      displayName: bestBase.match,
      baseName: bestBase.match,
    };
  }

  // Unique match only (no good base type found)
  if (bestUnique && bestUnique.score < 0.4) {
    return {
      type: 'unique',
      searchTerm: bestUnique.match,
      displayName: bestUnique.match,
    };
  }

  // Base type match only — rare item
  if (bestBase) {
    return {
      type: 'rare',
      searchTerm: bestBase.match,
      displayName: bestBase.match,
      baseName: bestBase.match,
    };
  }

  // Last resort: try the longest line as a general search
  const longest = [...lines].sort((a, b) => b.length - a.length)[0];
  return {
    type: 'currency',
    searchTerm: longest,
    displayName: longest,
  };
}
