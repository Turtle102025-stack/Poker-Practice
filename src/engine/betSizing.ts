import type { LegalActions } from './types';

/**
 * Bet-size helpers for the controls: pot-fraction sizes and turning any typed
 * amount into a legal one, with a plain-English note whenever it was changed.
 */

const money = (n: number) => `$${n.toLocaleString('en-US')}`;

/**
 * The "to" amount for a bet or raise of `fraction` of the pot.
 *
 * A bet is a fraction of the pot. A raise is sized the standard way: call
 * first, then raise by that fraction of the pot after calling. So a pot-sized
 * raise is to currentBet + (pot + amount to call).
 *
 * `pot` is everything in the middle, including bets already made on this street.
 */
export function potFractionTo(legal: LegalActions, pot: number, currentBet: number, fraction: number): number {
  if (legal.isBet) return fraction * pot;
  return currentBet + fraction * (pot + legal.facing);
}

/** Rounds to the nearest multiple of `unit` (at least one unit). */
export function roundToUnit(amount: number, unit: number): number {
  return Math.max(unit, Math.round(amount / unit) * unit);
}

export interface LegalAmount {
  to: number;
  /** Explanation when the requested amount had to be changed, otherwise null. */
  note: string | null;
  allIn: boolean;
}

/**
 * Turns a requested bet/raise "to" amount into a legal one.
 * `label` names where the amount came from (e.g. "⅓ pot") for the note.
 */
export function legalizeAmount(legal: LegalActions, requested: number, label?: string): LegalAmount {
  const verb = legal.isBet ? 'bet' : 'raise';
  const minText = `Minimum ${verb} is ${legal.isBet ? '' : 'to '}${money(legal.minTo)}`;
  const from = label ? `${label} would be ${money(Math.round(requested))}. ` : '';
  const done = (to: number, note: string | null): LegalAmount => ({ to, note, allIn: to === legal.maxTo });

  if (!legal.canRaise) return done(0, legal.raiseBlockedReason ?? 'You cannot raise here.');
  if (!Number.isFinite(requested) || requested <= 0) return done(legal.minTo, `Enter an amount. ${minText}.`);

  const whole = Math.round(requested);
  if (legal.minTo === legal.maxTo && whole !== legal.maxTo) {
    return done(legal.maxTo, `${from}You don't have enough for a full ${verb}, so the only option is all-in for ${money(legal.maxTo)}.`);
  }
  if (whole < legal.minTo) return done(legal.minTo, `${from}${minText}.`);
  if (whole > legal.maxTo) return done(legal.maxTo, `${from}That's more than you have. All-in is ${money(legal.maxTo)}.`);
  if (whole !== requested && !label) return done(whole, 'Bets are in whole dollars.');
  return done(whole, null);
}
