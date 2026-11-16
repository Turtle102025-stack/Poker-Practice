/**
 * The eight playing styles. Each is a set of parameters; individual players
 * vary around their style's values, and tilt shifts them during play.
 *
 * Preflop ranges are fractions of all starting hands (0.10 = the best 10%),
 * for a middle position at a full table. Position widens or narrows them.
 */
export type Archetype =
  | 'nit'
  | 'semiNit'
  | 'tightPassive'
  | 'loosePassive'
  | 'looseAggressive'
  | 'aggroReg'
  | 'goodReg'
  | 'shortStacker';

export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  nit: 'Nit',
  semiNit: 'Semi-nit',
  tightPassive: 'Tight Passive',
  loosePassive: 'Loose Passive Rec',
  looseAggressive: 'Loose Aggressive Rec',
  aggroReg: 'Overly Aggressive Reg',
  goodReg: 'Good Reg',
  shortStacker: 'Short Stacker',
};

/** Short labels for seat badges. */
export const ARCHETYPE_SHORT: Record<Archetype, string> = {
  nit: 'Nit',
  semiNit: 'Semi-nit',
  tightPassive: 'Tight Passive',
  loosePassive: 'LP Rec',
  looseAggressive: 'LAG Rec',
  aggroReg: 'Aggro Reg',
  goodReg: 'Good Reg',
  shortStacker: 'Short Stack',
};

export const ARCHETYPE_SUMMARIES: Record<Archetype, string> = {
  nit: 'Plays very few hands. Raises mean big pairs. Folds when scary cards hit the board.',
  semiNit: 'Tight, but a bit more active than a nit.',
  tightPassive: 'Plays few hands, mostly calls, rarely raises. Bets small even with monster hands.',
  loosePassive: 'Limps a lot, calls most raises, calls down with weak pairs, rarely bluffs.',
  looseAggressive: 'Plays lots of hands, bets big when it hits anything, hates folding, tilts after losing big pots.',
  aggroReg: 'Semi-competent, but 3-bets and keeps betting too much.',
  goodReg: 'Solid and balanced. Raises to isolate limpers and takes advantage of weak play.',
  shortStacker: 'Buys in for the minimum, mostly goes all in or folds before the flop, rebuys often.',
};

export interface StyleParams {
  /* ---- preflop ranges (fractions of all hands) ---- */
  /** Raise when first in. */
  openRaise: number;
  /** Extra range limped when first in (on top of the raise range). */
  openLimp: number;
  /** Chance of limping a hand that is good enough to raise (passive players). */
  limpStrong: number;
  /** Range to limp behind other limpers. */
  overLimp: number;
  /** Range to raise over limpers. */
  isoRaise: number;
  /** Range to call a single standard open raise. */
  callOpen: number;
  /** Range to 3-bet for value. */
  threeBet: number;
  /** Extra 3-bet bluffs, taken from hands just outside the calling range. */
  threeBetBluff: number;
  /** Range to call a 3-bet after opening. */
  callThreeBet: number;
  /** Range to 4-bet (or shove) against a 3-bet. */
  fourBet: number;
  /** 0..1: how much bigger raises shrink the calling range (recreational players barely notice). */
  sizeSensitivity: number;

  /* ---- preflop sizing ---- */
  openSizeBB: number;
  perLimperBB: number;
  threeBetMult: number;

  /* ---- postflop ---- */
  /** Continuation bet on the flop after raising preflop (with a hand that isn't a value bet). */
  cbet: number;
  /** Keep betting the turn after a flop bet. */
  barrel: number;
  /** Keep betting the river after a turn bet. */
  riverBarrel: number;
  /** Hand strength (0..1) needed to bet for value. */
  valueThreshold: number;
  /** Hand strength (0..1) needed to call a half-pot bet. */
  callThreshold: number;
  /** Hand strength (0..1) needed to raise for value. */
  raiseThreshold: number;
  /** 0..1: lowers the calling bar on later streets ("I've come this far"). */
  stickiness: number;
  /** 0..1: bluffing frequency. */
  bluff: number;
  /** 0..1: betting or raising with draws. */
  semiBluff: number;
  /** 0..1: checking or just calling with very strong hands. */
  slowplay: number;
  /** 0..1: chance to give up a medium hand when a scary card arrives. */
  scareFold: number;
  /** Bet sizes as fractions of the pot. */
  betSize: { value: number; bluff: number; small: number };
  /** Chance of overbetting the pot. */
  overbet: number;
  /** Raise size as a multiple of the bet faced. */
  raiseMult: number;

  /* ---- other habits ---- */
  /** 0..1: how strongly losing a big pot affects them. */
  tiltSensitivity: number;
  /** Chance to straddle when under the gun. */
  straddle: number;
  /** Chance to post a big blind to sit in rather than wait. */
  postToEnter: number;
  /** Adjusts to opponents' observed tendencies. */
  exploit: boolean;
  /** Push-or-fold player when short. */
  shortStack: boolean;
}

export const STYLES: Record<Archetype, StyleParams> = {
  nit: {
    openRaise: 0.14, openLimp: 0.02, limpStrong: 0.04, overLimp: 0.07, isoRaise: 0.1,
    callOpen: 0.08, threeBet: 0.03, threeBetBluff: 0, callThreeBet: 0.03, fourBet: 0.015, sizeSensitivity: 0.8,
    openSizeBB: 4.5, perLimperBB: 1, threeBetMult: 3.5,
    cbet: 0.55, barrel: 0.3, riverBarrel: 0.2,
    valueThreshold: 0.55, callThreshold: 0.44, raiseThreshold: 0.8, stickiness: 0.12,
    bluff: 0.04, semiBluff: 0.2, slowplay: 0.1, scareFold: 0.7,
    betSize: { value: 0.6, bluff: 0.5, small: 0.45 }, overbet: 0, raiseMult: 3,
    tiltSensitivity: 0.1, straddle: 0, postToEnter: 0.1, exploit: false, shortStack: false,
  },
  semiNit: {
    openRaise: 0.19, openLimp: 0.035, limpStrong: 0.06, overLimp: 0.12, isoRaise: 0.14,
    callOpen: 0.12, threeBet: 0.05, threeBetBluff: 0.004, callThreeBet: 0.045, fourBet: 0.02, sizeSensitivity: 0.7,
    openSizeBB: 4, perLimperBB: 1, threeBetMult: 3.3,
    cbet: 0.65, barrel: 0.4, riverBarrel: 0.28,
    valueThreshold: 0.5, callThreshold: 0.38, raiseThreshold: 0.75, stickiness: 0.28,
    bluff: 0.1, semiBluff: 0.35, slowplay: 0.15, scareFold: 0.45,
    betSize: { value: 0.6, bluff: 0.5, small: 0.4 }, overbet: 0, raiseMult: 3,
    tiltSensitivity: 0.2, straddle: 0.02, postToEnter: 0.2, exploit: false, shortStack: false,
  },
  tightPassive: {
    openRaise: 0.09, openLimp: 0.17, limpStrong: 0.25, overLimp: 0.2, isoRaise: 0.05,
    callOpen: 0.15, threeBet: 0.015, threeBetBluff: 0, callThreeBet: 0.04, fourBet: 0.008, sizeSensitivity: 0.6,
    openSizeBB: 3.5, perLimperBB: 0.5, threeBetMult: 2.8,
    cbet: 0.3, barrel: 0.2, riverBarrel: 0.12,
    valueThreshold: 0.65, callThreshold: 0.4, raiseThreshold: 0.88, stickiness: 0.45,
    bluff: 0.02, semiBluff: 0.08, slowplay: 0.45, scareFold: 0.5,
    betSize: { value: 0.3, bluff: 0.3, small: 0.25 }, overbet: 0, raiseMult: 2.2,
    tiltSensitivity: 0.15, straddle: 0, postToEnter: 0.1, exploit: false, shortStack: false,
  },
  loosePassive: {
    openRaise: 0.1, openLimp: 0.45, limpStrong: 0.4, overLimp: 0.55, isoRaise: 0.08,
    callOpen: 0.34, threeBet: 0.02, threeBetBluff: 0, callThreeBet: 0.18, fourBet: 0.01, sizeSensitivity: 0.3,
    openSizeBB: 4, perLimperBB: 1, threeBetMult: 3,
    cbet: 0.35, barrel: 0.22, riverBarrel: 0.15,
    valueThreshold: 0.5, callThreshold: 0.2, raiseThreshold: 0.85, stickiness: 0.85,
    bluff: 0.04, semiBluff: 0.1, slowplay: 0.3, scareFold: 0.12,
    betSize: { value: 0.45, bluff: 0.4, small: 0.3 }, overbet: 0.02, raiseMult: 2.5,
    tiltSensitivity: 0.35, straddle: 0.1, postToEnter: 0.3, exploit: false, shortStack: false,
  },
  looseAggressive: {
    openRaise: 0.32, openLimp: 0.25, limpStrong: 0.1, overLimp: 0.3, isoRaise: 0.3,
    callOpen: 0.36, threeBet: 0.08, threeBetBluff: 0.04, callThreeBet: 0.25, fourBet: 0.04, sizeSensitivity: 0.25,
    openSizeBB: 5.5, perLimperBB: 1.5, threeBetMult: 3.5,
    cbet: 0.85, barrel: 0.6, riverBarrel: 0.45,
    valueThreshold: 0.36, callThreshold: 0.27, raiseThreshold: 0.6, stickiness: 0.75,
    bluff: 0.32, semiBluff: 0.7, slowplay: 0.05, scareFold: 0.05,
    betSize: { value: 0.9, bluff: 0.85, small: 0.6 }, overbet: 0.3, raiseMult: 3.5,
    tiltSensitivity: 0.8, straddle: 0.35, postToEnter: 0.6, exploit: false, shortStack: false,
  },
  aggroReg: {
    openRaise: 0.32, openLimp: 0.01, limpStrong: 0.02, overLimp: 0.04, isoRaise: 0.38,
    callOpen: 0.14, threeBet: 0.09, threeBetBluff: 0.06, callThreeBet: 0.09, fourBet: 0.04, sizeSensitivity: 0.5,
    openSizeBB: 3.5, perLimperBB: 1, threeBetMult: 3.6,
    cbet: 0.95, barrel: 0.7, riverBarrel: 0.4,
    valueThreshold: 0.45, callThreshold: 0.3, raiseThreshold: 0.65, stickiness: 0.45,
    bluff: 0.38, semiBluff: 0.55, slowplay: 0.05, scareFold: 0.15,
    betSize: { value: 0.7, bluff: 0.7, small: 0.45 }, overbet: 0.1, raiseMult: 3,
    tiltSensitivity: 0.45, straddle: 0.15, postToEnter: 0.5, exploit: false, shortStack: false,
  },
  goodReg: {
    openRaise: 0.26, openLimp: 0, limpStrong: 0.01, overLimp: 0.05, isoRaise: 0.28,
    callOpen: 0.2, threeBet: 0.06, threeBetBluff: 0.03, callThreeBet: 0.08, fourBet: 0.03, sizeSensitivity: 0.6,
    openSizeBB: 3.5, perLimperBB: 1, threeBetMult: 3.2,
    cbet: 0.8, barrel: 0.5, riverBarrel: 0.33,
    valueThreshold: 0.4, callThreshold: 0.32, raiseThreshold: 0.68, stickiness: 0.4,
    bluff: 0.22, semiBluff: 0.45, slowplay: 0.12, scareFold: 0.25,
    betSize: { value: 0.66, bluff: 0.66, small: 0.33 }, overbet: 0.06, raiseMult: 3,
    tiltSensitivity: 0.12, straddle: 0.03, postToEnter: 0.3, exploit: true, shortStack: false,
  },
  shortStacker: {
    openRaise: 0.21, openLimp: 0.04, limpStrong: 0.05, overLimp: 0.08, isoRaise: 0.13,
    callOpen: 0.04, threeBet: 0.09, threeBetBluff: 0, callThreeBet: 0, fourBet: 0.09, sizeSensitivity: 0.5,
    openSizeBB: 3, perLimperBB: 1, threeBetMult: 3,
    cbet: 0.6, barrel: 0.5, riverBarrel: 0.5,
    valueThreshold: 0.45, callThreshold: 0.35, raiseThreshold: 0.6, stickiness: 0.5,
    bluff: 0.15, semiBluff: 0.6, slowplay: 0.05, scareFold: 0.2,
    betSize: { value: 0.75, bluff: 0.7, small: 0.5 }, overbet: 0, raiseMult: 3,
    tiltSensitivity: 0.2, straddle: 0, postToEnter: 0.3, exploit: false, shortStack: true,
  },
};

/** How much each style likes each stake level: [$1/$3, $2/$5, $5/$10, $10/$20, $50/$100]. */
export const STAKE_PREFERENCE: Record<Archetype, number[]> = {
  nit: [5, 4, 2, 1, 0.3],
  semiNit: [4, 4, 2.5, 1, 0.3],
  tightPassive: [5, 4, 2, 0.6, 0.3],
  loosePassive: [6, 4.5, 2, 1, 0.8],
  looseAggressive: [5, 4, 2.5, 1.5, 0.8],
  aggroReg: [1.5, 3, 4, 3, 1.2],
  goodReg: [0.8, 2, 4, 4, 2.5],
  shortStacker: [6, 5, 1, 0.3, 0.1],
};

/** Chance a busted player rebuys rather than leaving. */
export const REBUY_CHANCE: Record<Archetype, number> = {
  nit: 0.3, semiNit: 0.4, tightPassive: 0.4, loosePassive: 0.6,
  looseAggressive: 0.85, aggroReg: 0.65, goodReg: 0.55, shortStacker: 0.9,
};
