import type { Card } from './cards';
import { RANK_NAMES, RANK_PLURALS } from './cards';

/**
 * Hand evaluator for 5, 6 or 7 cards.
 *
 * Returns a single integer "hand value": a larger value is a better hand and
 * equal values tie. Layout: category in bits 20..23, then up to five ranks
 * (4 bits each) in order of importance.
 */
export type HandValue = number;

export const Category = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;
export type Category = (typeof Category)[keyof typeof Category];

export const CATEGORY_NAMES = [
  'High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight',
  'Flush', 'Full house', 'Four of a kind', 'Straight flush',
];

function pack(cat: number, r1 = 0, r2 = 0, r3 = 0, r4 = 0, r5 = 0): HandValue {
  return (cat << 20) | (r1 << 16) | (r2 << 12) | (r3 << 8) | (r4 << 4) | r5;
}

export function categoryOf(v: HandValue): Category {
  return (v >> 20) as Category;
}

/** The ranks stored in a hand value, most important first. */
export function ranksOf(v: HandValue): number[] {
  return [(v >> 16) & 15, (v >> 12) & 15, (v >> 8) & 15, (v >> 4) & 15, v & 15];
}

/**
 * Highest rank of a 5-card straight contained in a 13-bit rank mask, or -1.
 * The ace also counts low, so A-2-3-4-5 (the wheel) returns 3 (the Five).
 */
export function straightHigh(mask: number): number {
  // Shift left by one and copy the ace into bit 0 so it can play low.
  const m = (mask << 1) | ((mask >> 12) & 1);
  for (let top = 13; top >= 4; top--) {
    if (((m >> (top - 4)) & 0x1f) === 0x1f) return top - 1;
  }
  return -1;
}

/** Top `n` ranks from a rank mask, highest first. */
function topRanks(mask: number, n: number, exclude1 = -1, exclude2 = -1): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0 && out.length < n; r--) {
    if (r === exclude1 || r === exclude2) continue;
    if (mask & (1 << r)) out.push(r);
  }
  return out;
}

const counts = new Uint8Array(13);

export function evaluate(cards: readonly Card[]): HandValue {
  const n = cards.length;
  if (n < 5 || n > 7) throw new Error(`evaluate needs 5-7 cards, got ${n}`);
  counts.fill(0);
  let rankMask = 0;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0; // per-suit rank masks
  let c0 = 0, c1 = 0, c2 = 0, c3 = 0; // per-suit counts
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const r = c >> 2;
    const bit = 1 << r;
    counts[r]++;
    rankMask |= bit;
    switch (c & 3) {
      case 0: s0 |= bit; c0++; break;
      case 1: s1 |= bit; c1++; break;
      case 2: s2 |= bit; c2++; break;
      default: s3 |= bit; c3++; break;
    }
  }

  // Flush / straight flush. With at most 7 cards only one suit can have 5+.
  let flushMask = 0;
  if (c0 >= 5) flushMask = s0;
  else if (c1 >= 5) flushMask = s1;
  else if (c2 >= 5) flushMask = s2;
  else if (c3 >= 5) flushMask = s3;
  if (flushMask) {
    const sf = straightHigh(flushMask);
    if (sf >= 0) return pack(Category.StraightFlush, sf);
  }

  let quad = -1, trip1 = -1, trip2 = -1, pair1 = -1, pair2 = -1, pair3 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = counts[r];
    if (k === 4) quad = r;
    else if (k === 3) {
      if (trip1 < 0) trip1 = r; else if (trip2 < 0) trip2 = r;
    } else if (k === 2) {
      if (pair1 < 0) pair1 = r; else if (pair2 < 0) pair2 = r; else if (pair3 < 0) pair3 = r;
    }
  }

  if (quad >= 0) {
    const kicker = topRanks(rankMask, 1, quad)[0];
    return pack(Category.Quads, quad, kicker);
  }
  if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) {
    // Two sets: the lower set plays as the pair. Otherwise the best pair.
    const pairPart = Math.max(trip2, pair1);
    return pack(Category.FullHouse, trip1, pairPart);
  }
  if (flushMask) {
    const t = topRanks(flushMask, 5);
    return pack(Category.Flush, t[0], t[1], t[2], t[3], t[4]);
  }
  const st = straightHigh(rankMask);
  if (st >= 0) return pack(Category.Straight, st);
  if (trip1 >= 0) {
    const k = topRanks(rankMask, 2, trip1);
    return pack(Category.Trips, trip1, k[0], k[1]);
  }
  if (pair2 >= 0) {
    // With three pairs the third pair's rank can be the kicker.
    const k = topRanks(rankMask, 1, pair1, pair2)[0];
    return pack(Category.TwoPair, pair1, pair2, k);
  }
  if (pair1 >= 0) {
    const k = topRanks(rankMask, 3, pair1);
    return pack(Category.Pair, pair1, k[0], k[1], k[2]);
  }
  const t = topRanks(rankMask, 5);
  return pack(Category.HighCard, t[0], t[1], t[2], t[3], t[4]);
}

/** Description in PokerStars hand-history wording, e.g. "two pair, Kings and Sevens". */
export function describeHand(v: HandValue): string {
  const [r1, r2] = ranksOf(v);
  switch (categoryOf(v)) {
    case Category.StraightFlush:
      if (r1 === 12) return 'a Royal Flush';
      return `a straight flush, ${straightLow(r1)} to ${RANK_NAMES[r1]}`;
    case Category.Quads:
      return `four of a kind, ${RANK_PLURALS[r1]}`;
    case Category.FullHouse:
      return `a full house, ${RANK_PLURALS[r1]} full of ${RANK_PLURALS[r2]}`;
    case Category.Flush:
      return `a flush, ${RANK_NAMES[r1]} high`;
    case Category.Straight:
      return `a straight, ${straightLow(r1)} to ${RANK_NAMES[r1]}`;
    case Category.Trips:
      return `three of a kind, ${RANK_PLURALS[r1]}`;
    case Category.TwoPair:
      return `two pair, ${RANK_PLURALS[r1]} and ${RANK_PLURALS[r2]}`;
    case Category.Pair:
      return `a pair of ${RANK_PLURALS[r1]}`;
    default:
      return `high card ${RANK_NAMES[r1]}`;
  }
}

function straightLow(high: number): string {
  return high === 3 ? 'Ace' : RANK_NAMES[high - 4];
}

/** Longer description including kickers, for the on-screen log. */
export function describeHandLong(v: HandValue): string {
  const r = ranksOf(v);
  const base = describeHand(v);
  const name = (x: number) => RANK_NAMES[x];
  switch (categoryOf(v)) {
    case Category.Quads:
      return `${base}, ${name(r[1])} kicker`;
    case Category.Trips:
      return `${base}, ${name(r[1])}-${name(r[2])} kickers`;
    case Category.TwoPair:
      return `${base}, ${name(r[2])} kicker`;
    case Category.Pair:
      return `${base}, ${name(r[1])}-${name(r[2])}-${name(r[3])} kickers`;
    case Category.HighCard:
      return `high card ${r.map(name).join('-')}`;
    case Category.Flush:
      return `a flush, ${r.map(name).join('-')}`;
    default:
      return base;
  }
}

/** All k-element combinations of `items`. */
export function combinations<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const pick: T[] = [];
  const rec = (start: number) => {
    if (pick.length === k) {
      out.push(pick.slice());
      return;
    }
    for (let i = start; i <= items.length - (k - pick.length); i++) {
      pick.push(items[i]);
      rec(i + 1);
      pick.pop();
    }
  };
  rec(0);
  return out;
}

/** The five cards that make the best hand (for highlighting). */
export function bestFiveCards(cards: readonly Card[]): Card[] {
  const target = evaluate(cards);
  if (cards.length === 5) return cards.slice();
  for (const five of combinations(cards, 5)) {
    if (evaluate(five) === target) return five;
  }
  return cards.slice(0, 5);
}
