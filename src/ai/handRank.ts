import { rankOf, suitOf, RANK_CHARS, type Card } from '../engine/cards';
import { PREFLOP_ORDER } from './preflopRanks';

/** "AKs", "AKo" or "AA" for two hole cards. */
export function handCode(hole: readonly Card[]): string {
  const [a, b] = hole;
  const ra = rankOf(a), rb = rankOf(b);
  const hi = Math.max(ra, rb), lo = Math.min(ra, rb);
  if (hi === lo) return RANK_CHARS[hi] + RANK_CHARS[lo];
  return RANK_CHARS[hi] + RANK_CHARS[lo] + (suitOf(a) === suitOf(b) ? 's' : 'o');
}

const PERCENTILE = new Map<string, number>();
{
  let cum = 0;
  for (const code of PREFLOP_ORDER) {
    const combos = code.length === 2 ? 6 : code.endsWith('s') ? 4 : 12;
    // A hand is "in the top X%" when the share of combos ranked at or above it is <= X.
    cum += combos;
    PERCENTILE.set(code, cum / 1326);
  }
}

/**
 * Where a starting hand ranks, as the share of all hands that are at least as
 * good (AA = 0.0045, 72o ≈ 0.99). "In a 12% range" means percentile <= 0.12.
 */
export function handPercentile(hole: readonly Card[]): number {
  return PERCENTILE.get(handCode(hole))!;
}
