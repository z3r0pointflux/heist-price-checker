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
  /** Nothing tooltip-like was on screen at all, as opposed to an unreadable one. */
  noTooltip?: boolean;
}

/**
 * Whether the text read plausibly came from an item tooltip.
 *
 * When the hotkey fires with no tooltip up — mouse over empty floor, or pressed
 * before the tooltip faded in — OCR still returns a dozen scraps of scenery
 * ("Ba RE", "ALE Vio s Ag Ds") and the user got told the item was unreadable.
 * Real item names carry a long word; scenery noise tops out around four letters.
 */
function looksLikeTooltip(lines: string[]): boolean {
  return lines.some(line =>
    line.split(/\s+/).some(w => w.length >= 6 && /[aeiou]/i.test(w)));
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
/**
 * Forms of a line worth matching: the line itself, plus a copy with short
 * leading/trailing tokens removed.
 *
 * OCR leaves crumbs around the text ("Loe WRAITH AXE", "Ne Fo VICTORY HUNGER Ii")
 * which inflate the fuzzy score enough to push a correct match past threshold.
 * Both forms are tried because real bases like "War Axe" and "Sun Plate" start
 * with a short token that must not be stripped.
 */
function candidateForms(line: string): string[] {
  const tokens = line.split(/\s+/).filter(Boolean);
  const forms = new Set<string>([line]);

  // Where the leading crumbs end.
  let start = 0;
  while (start < tokens.length - 1 && tokens[start].length <= 3) start++;

  // Where the trailing crumbs begin. Three-letter tokens count, for the crumbs
  // the lock icons at the ends of a name box leave ("… ENRICHING Gib",
  // "… ANNULMENT gif").
  let end = tokens.length;
  while (end > 1 && tokens[end - 1].length <= 3) end--;

  // Both ends are trimmed INDEPENDENTLY, and at every cut in between rather than
  // only at the maximum. Two separate faults showed up in one currency name:
  //
  //   "ORB OF ANNULMENT  gif" — cutting the trailing "gif" also cut the leading
  //     "ORB OF", since both are three letters or fewer, leaving a bare
  //     "ANNULMENT" that the length guard rejected against "Orb of Annulment"
  //     (0.64 against the 0.65 floor). The exact form was never generated.
  //   "j ORB OF SCOURING" — the leading cut takes every short token it can, so
  //     it ran past the crumb and through "ORB OF" as well. Only the untrimmed
  //     line was left to match on, at 0.291 — inside the 0.3 cutoff by a hair.
  //
  // Every "Orb of ..." currency has that shape, so neither was one item's
  // problem. Cuts are capped at three tokens per end: real crumbs are one or two
  // tokens, and an uncapped sweep over a line of scenery noise would fan out to
  // dozens of forms, each costing a fuzzy search against every index.
  const MAX_CUT = 3;
  const startCuts = new Set<number>([0, start]);
  for (let i = 1; i <= MAX_CUT && i <= start; i++) startCuts.add(i);
  const endCuts = new Set<number>([tokens.length, end]);
  for (let i = 1; i <= MAX_CUT && tokens.length - i >= end; i++) endCuts.add(tokens.length - i);

  for (const from of startCuts) {
    for (const to of endCuts) {
      if (to > from) forms.add(tokens.slice(from, to).join(' '));
    }
  }

  // Every form is scored and the best wins, so widening this set can only help a
  // correct name; the length guard and score thresholds still reject the rest.
  return [...forms].filter(f => f.replace(/[^A-Za-z]/g, '').length >= 4);
}

/**
 * Reject matches where the text read is a very different length from the name
 * matched. The OCR crumb "IUNGER" scored 0.227 against "Voidbringer" and got a
 * rare axe priced as a unique; on length alone it never should have been a
 * candidate.
 */
function lengthCompatible(query: string, match: string): boolean {
  const a = query.replace(/[^A-Za-z]/g, '').length;
  const b = match.replace(/[^A-Za-z]/g, '').length;
  if (a === 0 || b === 0) return false;
  return Math.min(a, b) / Math.max(a, b) >= 0.65;
}

function matchLines(lines: string[], label: string): ItemInfo | null {
  // Walk top-down and take the first line that resolves. A PoE tooltip prints
  // the item name above its base type, so scoring globally let an exact hit on
  // "Great Helmet" outrank the fuzzy hit on "Replica Veil of the Night" one line
  // above it — naming the base instead of the unique that carries the value.
  type Candidate = { type: 'unique' | 'rare'; match: string; score: number; line: number; from: string };
  const candidates: Candidate[] = [];

  lines.forEach((line, index) => {
    if (line.replace(/[^A-Za-z]/g, '').length < 4) return;
    if (plausibility(line) < 0.9) return;

    const consider = (type: 'unique' | 'rare', query: string, match: string | undefined, score: number | undefined, limit: number) => {
      if (!match || score === undefined || score >= limit) return;
      if (!lengthCompatible(query, match)) return;
      candidates.push({ type, match, score, line: index, from: query });
    };

    for (const form of candidateForms(line)) {
      const rep = replicaFuse.search(form)[0];
      consider('unique', form, rep?.item, rep?.score, 0.3);
      const uniq = lookupUniqueName(form);
      consider('unique', form, uniq?.item.name, uniq?.score, 0.35);
      const curated = baseFuse.search(form)[0];
      consider('rare', form, curated?.item, curated?.score, 0.3);
      const bt = lookupBaseType(form);
      consider('rare', form, bt?.item.name, bt?.score, 0.35);
    }
  });

  if (candidates.length === 0) return null;

  // Quality of the match decides, not where it sat in the tooltip. Taking the
  // first line that matched anything let OCR crumbs win: "KX TRIETT" strips to
  // "TRIETT" and hits "Stiletto" at 0.343, beating "Hussar Brigandine" at 0.000
  // two lines below. Line order only breaks a near-tie, which is what separates
  // a unique's name from its base type when both match exactly.
  const bestScore = Math.min(...candidates.map(c => c.score));
  const TIE = 0.08;
  const contenders = candidates.filter(c => c.score <= bestScore + TIE);
  contenders.sort((a, b) =>
    a.line - b.line ||
    (a.type === b.type ? 0 : a.type === 'unique' ? -1 : 1) ||
    a.score - b.score);

  const hit = contenders[0];
  console.log(`[itemDetect] ${label} matched "${hit.match}" (${hit.type}, score ${hit.score.toFixed(3)}) from "${hit.from}"`);
  return {
    type: hit.type,
    searchTerm: hit.match,
    displayName: hit.match,
    ...(hit.type === 'rare' ? { baseName: hit.match } : {}),
  };
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
        if (
          lengthCompatible(line, replicaResults[0].item) &&
          (!bestReplica || replicaResults[0].score < bestReplica.score)
        ) {
          bestReplica = { match: replicaResults[0].item, score: replicaResults[0].score, line };
        }
      }
    }

    // Try experimented base match
    const baseResults = baseFuse.search(line);
    if (baseResults.length > 0 && baseResults[0].score !== undefined) {
      if (
        lengthCompatible(line, baseResults[0].item) &&
        (!bestBase || baseResults[0].score < bestBase.score)
      ) {
        bestBase = { match: baseResults[0].item, score: baseResults[0].score, line };
      }
    }

    // Try currency match (from poe.ninja data). The length guard matters most
    // here: the stackable pool grew from ~150 names to ~900 when the exchange
    // categories were added, and a five-letter stat label ("LIMIT") found
    // "Acclimatisation" at 0.230 — beating the correctly-read scarab name on the
    // line above it and pricing the item as a divination card.
    // Score the crumb-stripped forms too, not just the raw line — a trailing
    // "Gib" was enough to hold an exact scarab name at 0.346, just outside the
    // 0.3 candidate threshold, so the item priced as nothing at all.
    for (const form of candidateForms(line)) {
      const currencyResult = lookupCurrency(form);
      if (!currencyResult) continue;
      if (!lengthCompatible(form, currencyResult.item.name)) continue;
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
    for (const form of candidateForms(line)) {
      const cur = lookupCurrency(form);
      if (cur && cur.score < 0.2 && lengthCompatible(form, cur.item.name)) {
        console.log(`[itemDetect] Currency matched "${cur.item.name}" (score ${cur.score.toFixed(3)})`);
        return { type: 'currency', searchTerm: cur.item.name, displayName: cur.item.name };
      }
    }
  }

  // Genuinely unrecognised. Show the most name-like line rather than whichever
  // string happened to be longest, and flag it so the overlay can say so.
  const best = [...lines].sort((a, b) => plausibility(b) - plausibility(a))[0] ?? '';
  const noTooltip = !looksLikeTooltip(lines);
  console.log(`[itemDetect] No match; ${noTooltip ? 'no tooltip in frame' : `best-guess line "${best}"`}`);
  return {
    type: 'currency',
    searchTerm: noTooltip ? '' : best,
    displayName: noTooltip ? '' : best,
    unidentified: true,
    noTooltip,
  };
}
