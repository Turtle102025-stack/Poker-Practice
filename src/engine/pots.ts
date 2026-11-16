import type { PlayerState, Pot, RakeConfig } from './types';

/**
 * Builds the main pot and side pots from what each player put in.
 *
 * Each all-in amount among live players creates a level. Everyone's chips up to
 * that level (folded players included) go into the pot for that level, and only
 * live players who put in at least that much can win it. Neighbouring pots with
 * the same eligible players are merged.
 */
export function buildPots(players: readonly PlayerState[]): Pot[] {
  const live = players.filter((p) => !p.folded);
  const levels = [...new Set(live.map((p) => p.totalCommitted).filter((x) => x > 0))].sort(
    (a, b) => a - b,
  );
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) {
      amount += Math.min(p.totalCommitted, level) - Math.min(p.totalCommitted, prev);
    }
    const eligible = live.filter((p) => p.totalCommitted >= level).map((p) => p.seat);
    if (amount > 0) {
      const last = pots[pots.length - 1];
      if (last && sameSeats(last.eligible, eligible)) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    prev = level;
  }
  // Folded players' chips above every live player's total (rare) go into the last pot.
  const total = players.reduce((s, p) => s + p.totalCommitted, 0);
  const inPots = pots.reduce((s, p) => s + p.amount, 0);
  if (total > inPots) {
    if (pots.length === 0) pots.push({ amount: 0, eligible: live.map((p) => p.seat) });
    pots[pots.length - 1].amount += total - inPots;
  }
  return pots;
}

function sameSeats(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Splits `amount` among `winners`, which must already be ordered starting with
 * the first player to the left of the button. Odd chips go one at a time in that order.
 */
export function splitPot(amount: number, winners: readonly number[]): Map<number, number> {
  const share = Math.floor(amount / winners.length);
  let odd = amount - share * winners.length;
  const out = new Map<number, number>();
  for (const w of winners) {
    out.set(w, share + (odd > 0 ? 1 : 0));
    if (odd > 0) odd--;
  }
  return out;
}

/** Rake for a pot, in whole dollars (rounded down), or 0 if rake is off. */
export function computeRake(totalPot: number, flopDealt: boolean, cfg?: RakeConfig): number {
  if (!cfg || !cfg.enabled) return 0;
  if (cfg.noFlopNoDrop && !flopDealt) return 0;
  return Math.max(0, Math.min(cfg.cap, Math.floor((totalPot * cfg.percent) / 100)));
}

/** Removes rake from the pots, main pot first. Mutates and returns `pots`. */
export function takeRake(pots: Pot[], rake: number): Pot[] {
  let left = rake;
  for (const pot of pots) {
    const take = Math.min(pot.amount, left);
    pot.amount -= take;
    left -= take;
    if (left === 0) break;
  }
  return pots;
}
