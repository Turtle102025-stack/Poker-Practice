import { rankOf, suitOf } from '../engine/cards';
import { Category, categoryOf, evaluate } from '../engine/evaluator';
import type { Rng } from '../engine/rng';
import type { LegalActions, PlayerAction } from '../engine/types';
import type { PlayerView } from '../engine/view';

/**
 * A simple placeholder opponent used in Phases 1-2. It only sees its PlayerView.
 * Phase 3 replaces it with the 50 personalities.
 */

/** Chen formula score for two hole cards (roughly -1 to 20). */
export function chenScore(hole: readonly number[]): number {
  const [a, b] = hole;
  const ra = rankOf(a), rb = rankOf(b);
  const hi = Math.max(ra, rb), lo = Math.min(ra, rb);
  const value = (r: number) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  let score = value(hi);
  if (ra === rb) return Math.ceil(Math.max(5, score * 2));
  if (suitOf(a) === suitOf(b)) score += 2;
  const gap = hi - lo - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && hi < 10) score += 1;
  return Math.ceil(score);
}

function raiseTo(legal: LegalActions, desired: number): PlayerAction {
  const to = Math.max(legal.minTo, Math.min(legal.maxTo, Math.round(desired)));
  return { type: 'raise', to };
}

function passive(legal: LegalActions): PlayerAction {
  return legal.canCheck ? { type: 'check' } : { type: 'fold' };
}

export function basicBotDecide(view: PlayerView, rng: Rng): PlayerAction {
  const legal = view.legal;
  if (!legal) throw new Error('Not this player’s turn');
  const bb = view.bigBlind;
  const me = view.players.find((p) => p.seat === view.seat)!;
  const r = rng.float();

  if (view.board.length === 0) {
    const s = chenScore(view.hole);
    const facingBBs = legal.facing / bb;
    if (s >= 10) {
      if (legal.canRaise && (facingBBs <= 12 || s >= 12)) {
        const target = view.currentBet <= bb ? 3 * bb + (me.committed > 0 ? 0 : bb) : view.currentBet * 3;
        return raiseTo(legal, target);
      }
      return legal.canCall ? { type: 'call' } : { type: 'check' };
    }
    if (s >= 7) {
      if (facingBBs <= 1 && legal.canRaise && r < 0.4) return raiseTo(legal, 3 * bb);
      if (facingBBs <= 4) return legal.canCall ? { type: 'call' } : { type: 'check' };
      return passive(legal);
    }
    if (s >= 5 && facingBBs <= 1.01) return legal.canCall ? { type: 'call' } : { type: 'check' };
    return passive(legal);
  }

  const value = evaluate([...view.hole, ...view.board]);
  const cat = categoryOf(value);
  const pot = view.pot;
  if (cat >= Category.TwoPair) {
    if (legal.canRaise && r < 0.8) {
      return raiseTo(legal, legal.isBet ? pot * 0.65 : view.currentBet * 2.5);
    }
    return legal.canCall ? { type: 'call' } : { type: 'check' };
  }
  if (cat === Category.Pair) {
    if (legal.canCheck) {
      return legal.canRaise && r < 0.45 ? raiseTo(legal, pot * 0.45) : { type: 'check' };
    }
    return legal.facing <= pot * 0.6 ? { type: 'call' } : passive(legal);
  }
  if (legal.canCheck) {
    return legal.canRaise && r < 0.15 ? raiseTo(legal, pot * 0.5) : { type: 'check' };
  }
  return legal.facing <= pot * 0.25 && r < 0.4 ? { type: 'call' } : { type: 'fold' };
}
