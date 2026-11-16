import type { Card } from './cards';
import { combinations } from './evaluator';

/**
 * A deliberately simple, slow evaluator written independently of the fast one.
 * It scores every 5-card subset and keeps the best. Tests compare the two on
 * many random hands. Returns a comparable tuple encoded as a number.
 */
export function referenceEvaluate(cards: readonly Card[]): number {
  let best = -1;
  for (const five of combinations(cards, 5)) {
    const v = score5(five);
    if (v > best) best = v;
  }
  return best;
}

function score5(five: Card[]): number {
  const ranks = five.map((c) => c >> 2).sort((a, b) => b - a);
  const suits = five.map((c) => c & 3);
  const isFlush = suits.every((s) => s === suits[0]);

  const unique = [...new Set(ranks)];
  let straightTop = -1;
  if (unique.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightTop = ranks[0];
    else if (ranks.join(',') === '12,3,2,1,0') straightTop = 3; // wheel
  }

  // Group by count, then by rank, both descending.
  const countMap = new Map<number, number>();
  for (const r of ranks) countMap.set(r, (countMap.get(r) ?? 0) + 1);
  const groups = [...countMap.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join('');
  const ordered = groups.map((g) => g[0]);

  let cat: number;
  let key: number[];
  if (straightTop >= 0 && isFlush) { cat = 8; key = [straightTop]; }
  else if (shape === '41') { cat = 7; key = ordered; }
  else if (shape === '32') { cat = 6; key = ordered; }
  else if (isFlush) { cat = 5; key = ranks; }
  else if (straightTop >= 0) { cat = 4; key = [straightTop]; }
  else if (shape === '311') { cat = 3; key = ordered; }
  else if (shape === '221') { cat = 2; key = ordered; }
  else if (shape === '2111') { cat = 1; key = ordered; }
  else { cat = 0; key = ranks; }

  const k = [...key, 0, 0, 0, 0, 0].slice(0, 5);
  return (cat << 20) | (k[0] << 16) | (k[1] << 12) | (k[2] << 8) | (k[3] << 4) | k[4];
}
