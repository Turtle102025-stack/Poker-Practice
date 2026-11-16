/**
 * Position labels for any number of players.
 *
 * The blinds and the button are labeled by role. The remaining players, in
 * preflop action order, get labels counted back from the button (CO, HJ, LJ,
 * MP) and forward from the big blind (UTG, UTG+1, UTG+2):
 *
 *   6-handed: UTG HJ CO BTN SB BB
 *   9-handed: UTG UTG+1 MP LJ HJ CO BTN SB BB
 *  10-handed: UTG UTG+1 UTG+2 MP LJ HJ CO BTN SB BB
 *  Heads-up:  BTN/SB BB
 *
 * With a dead button nobody is labeled BTN; with a dead small blind nobody is
 * labeled SB.
 */
export type Position =
  | 'UTG' | 'UTG+1' | 'UTG+2' | 'UTG+3' | 'MP' | 'LJ' | 'HJ' | 'CO'
  | 'BTN' | 'SB' | 'BB' | 'BTN/SB';

const MIDDLE: Record<number, Position[]> = {
  0: [],
  1: ['UTG'],
  2: ['UTG', 'CO'],
  3: ['UTG', 'HJ', 'CO'],
  4: ['UTG', 'LJ', 'HJ', 'CO'],
  5: ['UTG', 'MP', 'LJ', 'HJ', 'CO'],
  6: ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'],
  7: ['UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO'],
  8: ['UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'MP', 'LJ', 'HJ', 'CO'],
};

export interface PositionInput {
  /** Seats dealt in, in clockwise order starting with the first seat after the button position. */
  orderFromButton: number[];
  /** Seat of the button if a dealt-in player holds it; null for a dead button. */
  buttonSeat: number | null;
  sbSeat: number | null;
  bbSeat: number;
}

export function labelPositions(p: PositionInput): Map<number, Position> {
  const labels = new Map<number, Position>();
  labels.set(p.bbSeat, 'BB');
  if (p.sbSeat !== null) labels.set(p.sbSeat, 'SB');
  if (p.buttonSeat !== null) {
    labels.set(p.buttonSeat, p.buttonSeat === p.sbSeat ? 'BTN/SB' : 'BTN');
  }
  // Remaining players in preflop action order: rotate so the list starts after the BB.
  const bbIdx = p.orderFromButton.indexOf(p.bbSeat);
  const rotated = [...p.orderFromButton.slice(bbIdx + 1), ...p.orderFromButton.slice(0, bbIdx)];
  const others = rotated.filter((s) => !labels.has(s));
  const names = MIDDLE[others.length];
  if (!names) throw new Error(`Too many players (${others.length + 3}) for position labels`);
  others.forEach((s, i) => labels.set(s, names[i]));
  return labels;
}
