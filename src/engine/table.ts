import type { Rng } from './rng';

/**
 * Button and blind movement between hands, using the dead-button rule
 * (Robert's Rules of Poker):
 *
 *  - The big blind always moves forward to the next seated player.
 *  - The small blind goes to the seat that had the big blind last hand. If
 *    that player has left, there is no small blind this hand.
 *  - The button goes to the seat that had the small blind last hand. If that
 *    seat is now empty, the button is "dead" (no one has it).
 *  - New players wait for the big blind, or post a live big blind to come in
 *    right away. They cannot come in on the button or between the button and
 *    the big blind.
 *  - Heads-up, the button posts the small blind.
 */

export type SeatStatus = 'active' | 'waitingForBB' | 'postToEnter';

export interface TableSeatInfo {
  seat: number;
  stack: number;
  status: SeatStatus;
}

export interface ButtonState {
  /** Seat of last hand's big blind; null before the first hand. */
  lastBBSeat: number | null;
  /** Seat position of last hand's small blind (may be a seat whose player has left). */
  lastSBPos: number | null;
}

export interface HandPlan {
  buttonSeat: number;
  sbSeat: number | null;
  bbSeat: number;
  /** Everyone dealt in, sorted by seat. */
  dealtIn: number[];
  /** New players posting a live big blind this hand. */
  livePosters: number[];
  /** Players whose status becomes 'active' because they are dealt in. */
  entering: number[];
  next: ButtonState;
}

export const NEW_BUTTON_STATE: ButtonState = { lastBBSeat: null, lastSBPos: null };

/** Clockwise distance from seat a to seat b (0 if equal). */
export function cwDist(a: number, b: number, numSeats: number): number {
  return (((b - a) % numSeats) + numSeats) % numSeats;
}

/**
 * Decides who is dealt in and where the button and blinds go for the next hand.
 * Returns null when fewer than two players can play.
 *
 * `firstButton` lets the caller fix the opening button (otherwise random, like
 * dealing high card for the button).
 */
export function planNextHand(
  seats: readonly TableSeatInfo[],
  numSeats: number,
  state: ButtonState,
  rng: Rng,
  firstButton?: number,
): HandPlan | null {
  const present = seats.filter((s) => s.stack > 0).sort((a, b) => a.seat - b.seat);
  const actives = present.filter((s) => s.status === 'active');

  // Fresh game: everyone present plays, no posting needed.
  if (state.lastBBSeat === null || actives.length < 2) {
    if (present.length < 2) return null;
    const btnIdx =
      firstButton !== undefined && present.some((s) => s.seat === firstButton)
        ? present.findIndex((s) => s.seat === firstButton)
        : rng.int(present.length);
    const at = (k: number) => present[(btnIdx + k) % present.length].seat;
    const buttonSeat = at(0);
    const headsUp = present.length === 2;
    const sbSeat = headsUp ? buttonSeat : at(1);
    const bbSeat = headsUp ? at(1) : at(2);
    return {
      buttonSeat,
      sbSeat,
      bbSeat,
      dealtIn: present.map((s) => s.seat),
      livePosters: [],
      entering: present.filter((s) => s.status !== 'active').map((s) => s.seat),
      next: { lastBBSeat: bbSeat, lastSBPos: sbSeat },
    };
  }

  const lastBB = state.lastBBSeat;
  const isActive = (seat: number) => actives.some((s) => s.seat === seat);
  const clockwiseAfter = (from: number) =>
    present
      .slice()
      .sort((a, b) => cwDist(from, a.seat, numSeats) - cwDist(from, b.seat, numSeats))
      .filter((s) => s.seat !== from);

  // Big blind: next seated player after last hand's big blind (any status).
  const bb = clockwiseAfter(lastBB)[0];
  if (!bb) return null;
  const bbSeat = bb.seat;

  // Small blind: last hand's big blind seat, if that player is still here.
  const sbPos = lastBB;
  const sbSeat: number | null = isActive(sbPos) && sbPos !== bbSeat ? sbPos : null;

  // Button: last hand's small blind position, if that still sits before the small blind.
  let buttonSeat = state.lastSBPos ?? sbPos;
  const validButton = (b: number) =>
    b !== sbPos && b !== bbSeat && cwDist(b, sbPos, numSeats) < cwDist(b, bbSeat, numSeats);
  if (!validButton(buttonSeat)) {
    // Happens when going from heads-up to three or more players: use the nearest
    // active player counter-clockwise from the small blind, or a dead button
    // just before it.
    let found: number | null = null;
    for (let k = 1; k < numSeats; k++) {
      const seat = (sbPos - k + numSeats) % numSeats;
      if (seat === bbSeat) break;
      if (isActive(seat)) {
        found = seat;
        break;
      }
    }
    buttonSeat = found ?? (sbPos - 1 + numSeats) % numSeats;
  }

  // Seats in the button-to-big-blind zone can't be entered by new players.
  const inEntryBlockedZone = (seat: number) =>
    cwDist(buttonSeat, seat, numSeats) < cwDist(buttonSeat, bbSeat, numSeats);

  const dealt = new Set<number>(actives.map((s) => s.seat));
  dealt.add(bbSeat);
  const livePosters = present
    .filter((s) => s.status === 'postToEnter' && s.seat !== bbSeat && !inEntryBlockedZone(s.seat))
    .map((s) => s.seat);
  livePosters.forEach((s) => dealt.add(s));

  const dealtIn = [...dealt].sort((a, b) => a - b);
  const entering = dealtIn.filter((seat) => !isActive(seat));

  if (dealtIn.length === 2) {
    // Heads-up: the big blind is set above; the other player has the button and small blind.
    const other = dealtIn.find((x) => x !== bbSeat)!;
    return {
      buttonSeat: other,
      sbSeat: other,
      bbSeat,
      dealtIn,
      livePosters: [],
      entering,
      next: { lastBBSeat: bbSeat, lastSBPos: other },
    };
  }

  return {
    buttonSeat,
    sbSeat,
    bbSeat,
    dealtIn,
    livePosters,
    entering,
    next: { lastBBSeat: bbSeat, lastSBPos: sbPos },
  };
}
