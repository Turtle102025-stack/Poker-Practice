import { rankOf, suitOf, type Card } from '../engine/cards';
import { Category, categoryOf, evaluate, ranksOf, straightHigh } from '../engine/evaluator';

/**
 * A quick read of how good a hand is on a given board, the way a player
 * thinks about it: "top pair, good kicker", "set", "flush draw", "the board
 * is four to a flush". No simulation, so it is fast enough for thousands of
 * decisions per second.
 */

export interface BoardTexture {
  paired: boolean;
  /** Three or more cards of one suit on board: a flush is possible. */
  flushPossible: boolean;
  /** Four or more of one suit on board. */
  fourFlush: boolean;
  /** Two of a suit on the flop/turn: a flush draw is possible. */
  flushDraw: boolean;
  /** Three board ranks within a five-rank window: a straight is possible. */
  straightPossible: boolean;
  /** Four board ranks within a five-rank window. */
  fourStraight: boolean;
  highRank: number;
  /** 0..1: how many draws the board allows. */
  wetness: number;
}

export interface HandRead {
  /** 0..1: made-hand strength, lowered when the board is dangerous. */
  strength: number;
  category: Category;
  /** Outs to improve (0 on the river). */
  outs: number;
  /** Rough chance of improving by the river (0 on the river). */
  drawEquity: number;
  hasFlushDraw: boolean;
  hasStraightDraw: boolean;
  /** For one pair: what kind. */
  pairKind: 'overpair' | 'top' | 'second' | 'low' | 'under' | 'board' | null;
}

function rankMask(cards: readonly Card[]): number {
  let m = 0;
  for (const c of cards) m |= 1 << rankOf(c);
  return m;
}

function maxInWindow(mask: number): number {
  // Most ranks present in any 5-rank straight window (ace counts high and low).
  const m = (mask << 1) | ((mask >> 12) & 1);
  let best = 0;
  for (let lo = 0; lo <= 9; lo++) {
    let n = 0;
    for (let k = 0; k < 5; k++) if (m & (1 << (lo + k))) n++;
    best = Math.max(best, n);
  }
  return best;
}

export function boardTexture(board: readonly Card[]): BoardTexture {
  const suits = [0, 0, 0, 0];
  const ranks = new Map<number, number>();
  for (const c of board) {
    suits[suitOf(c)]++;
    ranks.set(rankOf(c), (ranks.get(rankOf(c)) ?? 0) + 1);
  }
  const maxSuit = Math.max(...suits);
  const window = maxInWindow(rankMask(board));
  const paired = [...ranks.values()].some((n) => n >= 2);
  const flushDraw = board.length < 5 && maxSuit === 2;
  const wetness = Math.min(1, (maxSuit >= 3 ? 0.5 : flushDraw ? 0.3 : 0) + (window >= 4 ? 0.5 : window === 3 ? 0.35 : window === 2 ? 0.1 : 0));
  return {
    paired,
    flushPossible: maxSuit >= 3,
    fourFlush: maxSuit >= 4,
    flushDraw,
    straightPossible: window >= 3,
    fourStraight: window >= 4,
    highRank: Math.max(...board.map(rankOf)),
    wetness,
  };
}

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

export function readHand(hole: readonly Card[], board: readonly Card[]): HandRead {
  const all = [...hole, ...board];
  const value = evaluate(all);
  const cat = categoryOf(value);
  const tex = boardTexture(board);
  const [h1, h2] = hole.map(rankOf).sort((a, b) => b - a);
  const pocket = h1 === h2;
  const boardRanks = board.map(rankOf);
  const boardCount = (r: number) => boardRanks.filter((x) => x === r).length;
  const distinctBoard = [...new Set(boardRanks)].sort((a, b) => b - a);
  const top = distinctBoard[0];

  let s: number;
  let pairKind: HandRead['pairKind'] = null;
  const danger = (flushHit: number, fourFlushHit: number, straightHit: number, pairedHit: number) =>
    (tex.fourFlush ? fourFlushHit : tex.flushPossible ? flushHit : 0) +
    (tex.fourStraight ? straightHit : 0) +
    (tex.paired ? pairedHit : 0);

  switch (cat) {
    case Category.StraightFlush:
      s = 1;
      break;
    case Category.Quads: {
      const quad = ranksOf(value)[0];
      s = boardCount(quad) === 4 ? (h1 >= 11 ? 0.65 : 0.3) : 0.99;
      break;
    }
    case Category.FullHouse: {
      const boardTrips = distinctBoard.some((r) => boardCount(r) >= 3);
      const boardOnly = board.length === 5 && categoryOf(evaluate(board)) === Category.FullHouse && value === evaluate(board);
      s = boardOnly ? 0.4 : boardTrips ? 0.8 : 0.93;
      break;
    }
    case Category.Flush: {
      const suit = [0, 1, 2, 3].find((x) => all.filter((c) => suitOf(c) === x).length >= 5)!;
      const myFlushRanks = hole.filter((c) => suitOf(c) === suit).map(rankOf);
      if (myFlushRanks.length === 0) {
        s = 0.3; // the board's flush
      } else {
        const hi = Math.max(...myFlushRanks);
        const boardSuitRanks = board.filter((c) => suitOf(c) === suit).map(rankOf);
        // How many higher cards of that suit are still out there.
        let higher = 0;
        for (let r = hi + 1; r <= 12; r++) if (!boardSuitRanks.includes(r)) higher++;
        s = higher === 0 ? 0.95 : higher === 1 ? 0.86 : higher <= 3 ? 0.8 : 0.72;
        if (tex.fourFlush && myFlushRanks.length === 1 && higher > 2) s -= 0.15;
      }
      if (tex.paired) s -= 0.12;
      break;
    }
    case Category.Straight: {
      const high = ranksOf(value)[0];
      const boardStraight = board.length === 5 && categoryOf(evaluate(board)) === Category.Straight && straightHigh(rankMask(board)) === high;
      s = boardStraight ? 0.38 : 0.8;
      // The low end of a straight is weaker.
      if (!boardStraight && straightHigh(rankMask(board) | (1 << (high + 1))) > high) s -= 0.06;
      s -= danger(0.18, 0.35, 0, 0.1);
      break;
    }
    case Category.Trips: {
      const t = ranksOf(value)[0];
      if (pocket && h1 === t) s = t === top ? 0.9 : 0.86; // set
      else if (boardCount(t) === 3) s = 0.18 + (h1 === 12 ? 0.08 : h1 === 11 ? 0.04 : 0); // board trips
      else s = 0.68 + (Math.max(h1 === t ? h2 : h1) / 12) * 0.06; // trips with kicker
      s -= danger(0.12, 0.3, 0.15, 0);
      break;
    }
    case Category.TwoPair: {
      const [p1, p2] = ranksOf(value);
      const holeHits = [h1, h2].filter((r) => boardRanks.includes(r));
      if (!pocket && holeHits.length === 2 && h1 !== h2) {
        // Both hole cards pair the board: real two pair.
        s = h1 === top ? 0.74 : 0.66;
      } else if (pocket) {
        // Pocket pair plus a board pair: about as good as the pocket pair on the rest of the board.
        const unpaired = distinctBoard.filter((r) => boardCount(r) === 1);
        const over = unpaired.filter((r) => r > h1).length;
        s = over === 0 ? 0.58 : over === 1 ? 0.36 : 0.24;
        pairKind = over === 0 ? 'overpair' : 'under';
      } else if (holeHits.length === 1) {
        // One hole card pairs the board, plus a board pair: one pair in practice.
        const r = holeHits[0];
        const unpaired = distinctBoard.filter((x) => boardCount(x) === 1);
        const rank = unpaired.indexOf(r);
        const kicker = r === h1 ? h2 : h1;
        s = rank === 0 ? 0.52 + kickerBonus(kicker) : rank === 1 ? 0.36 : 0.28;
        pairKind = rank === 0 ? 'top' : rank === 1 ? 'second' : 'low';
      } else {
        // The board has two pair; only the kicker is ours.
        s = 0.12 + (h1 === 12 ? 0.1 : h1 >= 10 ? 0.04 : 0);
        pairKind = 'board';
      }
      void p1; void p2;
      s -= danger(0.1, 0.25, 0.12, 0);
      break;
    }
    case Category.Pair: {
      const p = ranksOf(value)[0];
      if (pocket) {
        const over = distinctBoard.filter((r) => r > p).length;
        if (over === 0) {
          s = 0.6 + (p - 7) * 0.012;
          pairKind = 'overpair';
        } else {
          s = over === 1 ? 0.36 : over === 2 ? 0.27 : 0.2;
          pairKind = 'under';
        }
      } else if (boardCount(p) >= 2) {
        s = 0.06 + (h1 === 12 ? 0.08 : h1 === 11 ? 0.04 : 0);
        pairKind = 'board';
      } else {
        const idx = distinctBoard.indexOf(p);
        const kicker = p === h1 ? h2 : h1;
        if (idx === 0) {
          s = 0.48 + kickerBonus(kicker);
          pairKind = 'top';
        } else if (idx === 1) {
          s = 0.34;
          pairKind = 'second';
        } else {
          s = 0.25;
          pairKind = 'low';
        }
      }
      s -= danger(0.08, 0.15, 0.08, 0);
      break;
    }
    default:
      s = 0.03 + (h1 === 12 ? 0.08 : h1 === 11 ? 0.04 : 0);
  }

  // Draws.
  let outs = 0;
  let hasFlushDraw = false;
  let hasStraightDraw = false;
  if (board.length < 5 && cat < Category.Flush) {
    for (let suit = 0; suit < 4; suit++) {
      const n = all.filter((c) => suitOf(c) === suit).length;
      const mine = hole.filter((c) => suitOf(c) === suit).length;
      if (n === 4 && mine >= 1) {
        hasFlushDraw = true;
        outs += 9;
      }
    }
    if (cat < Category.Straight) {
      const mask = rankMask(all);
      const boardMask = rankMask(board);
      const current = straightHigh(mask);
      let completing = 0;
      for (let r = 0; r <= 12; r++) {
        if (mask & (1 << r)) continue;
        const hi = straightHigh(mask | (1 << r));
        if (hi > current && hi !== straightHigh(boardMask | (1 << r))) completing++;
      }
      if (completing >= 2) {
        outs += 8;
        hasStraightDraw = true;
      } else if (completing === 1) {
        outs += 4;
        hasStraightDraw = true;
      }
      if (hasFlushDraw && hasStraightDraw) outs -= 2;
    }
    // Two overcards to an unpaired board give a few extra outs.
    if (cat === Category.HighCard && h2 > top && !tex.paired) outs += 3;
  }
  const unseen = 52 - all.length;
  const drawEquity =
    board.length === 3 ? 1 - ((unseen - outs) / unseen) * ((unseen - 1 - outs) / (unseen - 1))
    : board.length === 4 ? outs / unseen
    : 0;

  return {
    strength: clamp(s),
    category: cat,
    outs,
    drawEquity: clamp(drawEquity),
    hasFlushDraw,
    hasStraightDraw,
    pairKind,
  };
}

function kickerBonus(kicker: number): number {
  return kicker === 12 ? 0.09 : kicker === 11 ? 0.07 : kicker === 10 ? 0.05 : kicker === 9 ? 0.03 : kicker >= 7 ? 0.01 : 0;
}

/**
 * Did the latest board card make things scarier for a one-pair-ish hand?
 * (completes a possible flush or straight, or is an overcard to our pair)
 */
export function isScareCard(hole: readonly Card[], board: readonly Card[]): boolean {
  if (board.length < 4) return false;
  const before = boardTexture(board.slice(0, -1));
  const after = boardTexture(board);
  if (after.flushPossible && !before.flushPossible) return true;
  if (after.fourFlush && !before.fourFlush) return true;
  if (after.fourStraight && !before.fourStraight) return true;
  const card = rankOf(board[board.length - 1]);
  const prevTop = Math.max(...board.slice(0, -1).map(rankOf));
  const read = readHand(hole, board.slice(0, -1));
  if ((read.pairKind === 'overpair' || read.pairKind === 'top') && card > prevTop) return true;
  return false;
}
