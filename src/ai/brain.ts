import type { Rng } from '../engine/rng';
import type { BetEvent, LegalActions, PlayerAction } from '../engine/types';
import type { PlayerView, PublicPlayer } from '../engine/view';
import type { StyleParams } from './archetypes';
import { boardTexture, isScareCard, readHand } from './handRead';
import { handPercentile } from './handRank';
import type { ObservedStats } from './publicStats';
import { niceAmount } from './sizing';

/**
 * Decides a computer player's action. It sees only `view` (its own cards, the
 * board, the public betting, stacks), its style, its current tilt, and the
 * public stats anyone at the table could have observed.
 */
export interface BrainContext {
  params: StyleParams;
  /** 0..1, from losing big pots recently. */
  tilt: number;
  rng: Rng;
  /** Public stats on another player, by player id (used by players who adjust to opponents). */
  stats?: (playerId: string) => ObservedStats | null;
}

/** First-in raise range multiplier by number of players left to act behind. */
const POSITION_MULT = [1, 1.25, 1.9, 1.35, 1, 0.85, 0.75, 0.68, 0.6, 0.55, 0.55];

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Style parameters shifted by tilt: looser preflop, more bluffs, fewer folds, bigger bets. */
export function applyTilt(p: StyleParams, tilt: number): StyleParams {
  if (tilt <= 0.01) return p;
  const loose = 1 + tilt;
  return {
    ...p,
    openRaise: Math.min(0.6, p.openRaise * (1 + 0.6 * tilt)),
    openLimp: Math.min(0.6, p.openLimp * loose + 0.05 * tilt),
    overLimp: Math.min(0.7, p.overLimp * loose + 0.05 * tilt),
    isoRaise: Math.min(0.6, p.isoRaise * (1 + 0.6 * tilt)),
    callOpen: Math.min(0.6, p.callOpen * loose + 0.05 * tilt),
    threeBetBluff: p.threeBetBluff + 0.03 * tilt,
    callThreeBet: Math.min(0.4, p.callThreeBet * loose),
    bluff: Math.min(0.9, p.bluff + 0.35 * tilt),
    semiBluff: Math.min(0.95, p.semiBluff + 0.2 * tilt),
    callThreshold: p.callThreshold - 0.15 * tilt,
    stickiness: Math.min(1, p.stickiness + 0.3 * tilt),
    scareFold: p.scareFold * (1 - tilt),
    betSize: { value: p.betSize.value * (1 + 0.3 * tilt), bluff: p.betSize.bluff * (1 + 0.3 * tilt), small: p.betSize.small },
    overbet: Math.min(0.7, p.overbet + 0.2 * tilt),
    sizeSensitivity: p.sizeSensitivity * (1 - 0.5 * tilt),
  };
}

export function decide(view: PlayerView, ctx: BrainContext): PlayerAction {
  const legal = view.legal;
  if (!legal) throw new Error('Not this player’s turn');
  const params = applyTilt(ctx.params, ctx.tilt);
  const action = view.board.length === 0 ? preflop(view, legal, params, ctx) : postflop(view, legal, params, ctx);
  return sanitize(action, legal);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function me(view: PlayerView): PublicPlayer {
  return view.players.find((p) => p.seat === view.seat)!;
}

function clockwiseAfter(view: PlayerView, fromSeat: number): PublicPlayer[] {
  const after = view.players.filter((p) => p.seat > fromSeat);
  const before = view.players.filter((p) => p.seat <= fromSeat);
  return [...after, ...before];
}

function betEvents(view: PlayerView): BetEvent[] {
  return view.events.filter((e): e is BetEvent => e.type === 'bet');
}

function check(legal: LegalActions): PlayerAction {
  return legal.canCheck ? { type: 'check' } : { type: 'fold' };
}

function callOrCheck(legal: LegalActions): PlayerAction {
  return legal.canCheck ? { type: 'check' } : { type: 'call' };
}

/** A bet or raise to `to`, rounded to live-style amounts; shoves when it's most of the stack. */
function raiseTo(view: PlayerView, legal: LegalActions, to: number): PlayerAction {
  if (!legal.canRaise) return callOrCheck(legal);
  let amount = niceAmount(to, view.bigBlind);
  if (amount >= legal.maxTo * 0.85) amount = legal.maxTo;
  amount = clamp(amount, legal.minTo, legal.maxTo);
  return { type: legal.isBet ? 'bet' : 'raise', to: amount };
}

/** Never send an illegal action. */
function sanitize(a: PlayerAction, legal: LegalActions): PlayerAction {
  if (a.type === 'check' && !legal.canCheck) return { type: 'fold' };
  if (a.type === 'call' && !legal.canCall) return { type: 'check' };
  if (a.type === 'fold' && legal.canCheck) return { type: 'check' };
  if ((a.type === 'bet' || a.type === 'raise') && !legal.canRaise) return callOrCheck(legal);
  if (a.type === 'bet' || a.type === 'raise') {
    return { type: legal.isBet ? 'bet' : 'raise', to: clamp(Math.round(a.to), legal.minTo, legal.maxTo) };
  }
  return a;
}

function totalStack(p: PublicPlayer): number {
  return p.stack + p.committed;
}

/** Opponents' observed stats, used by players who adjust to opponents. */
function opponentRead(view: PlayerView, ctx: BrainContext, seats: number[]) {
  let station = false, nit = false, maniac = false;
  if (!ctx.params.exploit || !ctx.stats) return { station, nit, maniac };
  for (const seat of seats) {
    const p = view.players.find((x) => x.seat === seat);
    const st = p && ctx.stats(p.id);
    if (!st || st.hands < 12 || st.vpip === null || st.pfr === null) continue;
    if (st.vpip > 0.35 && st.pfr < 0.12) station = true;
    if (st.vpip < 0.16) nit = true;
    if (st.pfr > 0.22 || (st.af !== null && st.af > 3)) maniac = true;
  }
  return { station, nit, maniac };
}

/* ------------------------------------------------------------------ */
/* Preflop                                                             */
/* ------------------------------------------------------------------ */

interface PreflopSpot {
  raises: number;
  limpers: number;
  callersSinceRaise: number;
  iRaised: boolean;
  iLimped: boolean;
  lastRaiser: number | null;
  /** Live players still to act behind me before the action closes (position). */
  behind: number;
  base: number;
}

function preflopSpot(view: PlayerView): PreflopSpot {
  const evs = betEvents(view).filter((e) => e.street === 'preflop' && e.action !== 'post');
  let raises = 0, limpers = 0, callersSinceRaise = 0;
  let iRaised = false, iLimped = false;
  let lastRaiser: number | null = null;
  for (const e of evs) {
    if (e.action === 'raise') {
      raises++;
      lastRaiser = e.seat;
      callersSinceRaise = 0;
      if (e.seat === view.seat) iRaised = true;
    } else if (e.action === 'call') {
      if (raises === 0) {
        limpers++;
        if (e.seat === view.seat) iLimped = true;
      } else callersSinceRaise++;
    }
  }
  const lastBlind = view.straddleSeat ?? view.bbSeat;
  const order = clockwiseAfter(view, lastBlind);
  const idx = order.findIndex((p) => p.seat === view.seat);
  const behind = order.slice(idx + 1).filter((p) => !p.folded).length;
  return {
    raises, limpers, callersSinceRaise, iRaised, iLimped, lastRaiser, behind,
    base: view.straddleSeat !== null ? 2 * view.bigBlind : view.bigBlind,
  };
}

function preflop(view: PlayerView, legal: LegalActions, p: StyleParams, ctx: BrainContext): PlayerAction {
  const rng = ctx.rng;
  const hp = handPercentile(view.hole);
  const spot = preflopSpot(view);
  const self = me(view);
  const bb = view.bigBlind;
  const myTotal = totalStack(self);
  const biggestOpp = Math.max(...view.players.filter((x) => x.seat !== view.seat && !x.folded).map(totalStack));
  const effBB = Math.min(myTotal, biggestOpp) / bb;
  const posMult = POSITION_MULT[Math.min(spot.behind, 10)];
  const jitter = () => 0.85 + 0.3 * rng.float();

  // Push-or-fold when short.
  if ((p.shortStack && effBB <= 45) || effBB <= 12) return pushFold(view, legal, p, spot, hp, effBB, rng);

  // A call that costs most of the stack is an all-in decision.
  if (legal.canCall && legal.callAmount >= 0.45 * myTotal && spot.raises > 0) {
    const range = spot.raises === 1 ? p.threeBet + p.callOpen * 0.3 : spot.raises === 2 ? p.fourBet * 1.6 : p.fourBet * 1.2;
    const loose = 1 + p.stickiness * 0.8;
    return hp < range * loose * jitter() ? (legal.canRaise && hp < p.fourBet * 0.5 ? { type: 'allin' } : { type: 'call' }) : { type: 'fold' };
  }

  const read = opponentRead(
    view, ctx,
    view.players.filter((x) => x.seat !== view.seat && !x.folded).map((x) => x.seat),
  );

  // Nobody has raised.
  if (spot.raises === 0) {
    if (legal.canCheck) {
      // Big blind / straddle option.
      const range = (spot.limpers > 0 ? p.isoRaise * 0.6 : p.openRaise * 0.8) * jitter();
      if (hp < range) return raiseTo(view, legal, view.currentBet + spot.base * (p.openSizeBB - 1) + spot.limpers * p.perLimperBB * spot.base);
      return { type: 'check' };
    }
    const isSB = view.sbSeat === view.seat && self.committed > 0 && self.committed < view.currentBet && spot.behind <= 2;
    if (spot.limpers === 0) {
      const raiseRange = p.openRaise * posMult * (read.nit && spot.behind <= 3 ? 1.3 : 1) * jitter();
      const enterRange = raiseRange + p.openLimp * posMult * (isSB ? 1.4 : 1) * jitter();
      if (hp < raiseRange) {
        if (rng.float() < p.limpStrong) return { type: 'call' };
        return raiseTo(view, legal, spot.base * p.openSizeBB);
      }
      if (hp < enterRange) return { type: 'call' };
      return { type: 'fold' };
    }
    // Limpers in front.
    const isoRange = p.isoRaise * Math.sqrt(posMult) * (read.station ? 1.4 : 1) * jitter();
    if (hp < isoRange && rng.float() > p.limpStrong * 0.5) {
      return raiseTo(view, legal, spot.base * (p.openSizeBB + p.perLimperBB * spot.limpers));
    }
    const limpRange = p.overLimp * (1 + 0.12 * spot.limpers) * (isSB ? 1.5 : 1) * jitter();
    if (hp < Math.max(limpRange, isoRange)) return { type: 'call' };
    return { type: 'fold' };
  }

  const raiseBB = view.currentBet / spot.base;
  const isBB = view.bbSeat === view.seat || view.straddleSeat === view.seat;
  const isSB = view.sbSeat === view.seat;

  // Facing a single raise.
  if (spot.raises === 1) {
    const sizeFactor = clamp(Math.pow(3.5 / Math.max(raiseBB, 2), p.sizeSensitivity), 0.2, 1.4);
    const posAdj = isBB ? 1.5 : isSB ? 0.7 : 1;
    const multi = 1 + spot.callersSinceRaise * (0.1 + 0.2 * (1 - p.sizeSensitivity));
    const raiserTight = read.nit && spot.lastRaiser !== null;
    let callRange = p.callOpen * sizeFactor * posAdj * multi * (spot.iLimped ? 1.4 : 1) * (raiserTight ? 0.7 : 1) * jitter();
    const threeBetRange = p.threeBet * (isBB || isSB ? 0.9 : 1) * (read.maniac ? 1.4 : 1) * jitter();
    callRange = Math.max(callRange, threeBetRange);
    if (hp < threeBetRange) {
      const ip = !isBB && !isSB;
      const mult = p.threeBetMult + (ip ? 0 : 0.5) + spot.callersSinceRaise;
      return raiseTo(view, legal, view.currentBet * mult);
    }
    if (hp < callRange) return { type: 'call' };
    if (!raiserTight && hp < callRange + p.threeBetBluff && rng.float() < 0.7) {
      return raiseTo(view, legal, view.currentBet * (p.threeBetMult + 0.3));
    }
    return { type: 'fold' };
  }

  // Facing a 3-bet.
  if (spot.raises === 2) {
    const sizeFactor = clamp(Math.pow(3 / Math.max(view.currentBet / Math.max(self.committed, spot.base), 1.5), p.sizeSensitivity * 0.5), 0.4, 1.3);
    if (spot.iRaised) {
      if (hp < p.fourBet * jitter()) return raiseTo(view, legal, view.currentBet * 2.3);
      if (hp < p.callThreeBet * sizeFactor * jitter()) return { type: 'call' };
      return { type: 'fold' };
    }
    if (hp < p.fourBet * 0.7 * jitter()) return raiseTo(view, legal, view.currentBet * 2.4);
    if (hp < p.callThreeBet * 0.5 * jitter()) return { type: 'call' };
    return { type: 'fold' };
  }

  // Facing a 4-bet or more.
  if (hp < p.fourBet * 0.55 * jitter()) return legal.canRaise ? { type: 'allin' } : { type: 'call' };
  if (hp < p.fourBet * jitter() && legal.callAmount < 0.35 * myTotal) return { type: 'call' };
  return { type: 'fold' };
}

function pushFold(view: PlayerView, legal: LegalActions, p: StyleParams, spot: PreflopSpot, hp: number, effBB: number, rng: Rng): PlayerAction {
  const posMult = POSITION_MULT[Math.min(spot.behind, 10)];
  const deep = effBB > 15 ? 1 : 1.8;
  const j = 0.85 + 0.3 * rng.float();
  if (spot.raises === 0) {
    if (legal.canCheck) {
      return hp < p.isoRaise * 0.8 * j ? { type: 'allin' } : { type: 'check' };
    }
    const range = (spot.limpers > 0 ? p.isoRaise : p.openRaise) * posMult * deep * j;
    if (hp < range) return { type: 'allin' };
    // An occasional limp with a hand just outside the shoving range.
    if (hp < range + p.openLimp && rng.float() < 0.5) return { type: 'call' };
    return { type: 'fold' };
  }
  const facingBB = view.currentBet / view.bigBlind;
  const range = (spot.raises === 1 ? p.threeBet * (facingBB <= 5 ? 1.25 : 1) : p.fourBet) * deep * j;
  if (hp < range) return { type: 'allin' };
  return { type: 'fold' };
}

/* ------------------------------------------------------------------ */
/* Postflop                                                            */
/* ------------------------------------------------------------------ */

function postflop(view: PlayerView, legal: LegalActions, p: StyleParams, ctx: BrainContext): PlayerAction {
  const rng = ctx.rng;
  const hr = readHand(view.hole, view.board);
  const tex = boardTexture(view.board);
  const self = me(view);
  const streetIdx = view.board.length - 3; // 0 flop, 1 turn, 2 river
  const street = streetIdx === 0 ? 'flop' : streetIdx === 1 ? 'turn' : 'river';
  const prevStreet = streetIdx === 0 ? 'preflop' : streetIdx === 1 ? 'flop' : 'turn';
  const evs = betEvents(view);
  const opponents = view.players.filter((x) => x.seat !== view.seat && !x.folded);
  const opp = opponents.length;
  const mw = Math.pow(0.6, opp - 1);
  const pot = view.pot;

  // Who was aggressive on earlier streets.
  const lastAggressorOn = (st: string) => {
    let s: number | null = null;
    for (const e of evs) if (e.street === st && (e.action === 'bet' || e.action === 'raise')) s = e.seat;
    return s;
  };
  const pfAggressor = lastAggressorOn('preflop');
  const iBetLastStreet = lastAggressorOn(prevStreet) === view.seat;
  const postflopOrder = clockwiseAfter(view, view.buttonSeat).filter((x) => !x.folded);
  const inPosition = postflopOrder[postflopOrder.length - 1]?.seat === view.seat;

  const read = opponentRead(view, ctx, opponents.map((o) => o.seat));
  const bluffFreq = p.bluff * (read.station ? 0.3 : 1) * (read.nit ? 1.3 : 1);
  const valueBar = p.valueThreshold - (read.station ? 0.08 : 0) + 0.04 * (opp - 1);

  const s = hr.strength;
  const draw = hr.drawEquity;
  const scare = isScareCard(view.hole, view.board) && s < 0.8;
  const myStack = self.stack;

  const sizeFor = (kind: 'value' | 'bluff' | 'small'): number => {
    let f = p.betSize[kind];
    if (p.exploit) f = kind === 'small' ? f : tex.wetness > 0.45 ? Math.max(f, 0.7) : kind === 'value' ? 0.5 : 0.4;
    if (street === 'river' && kind !== 'small') f += 0.1;
    if (read.station && kind === 'value') f *= 1.2;
    if (kind !== 'small' && rng.float() < p.overbet) f = 1.2 + 0.4 * rng.float();
    f *= 0.9 + 0.2 * rng.float();
    return f;
  };
  const betPot = (fraction: number) => raiseTo(view, legal, Math.max(view.bigBlind, pot * fraction));

  /* ---- No bet to us: bet or check ---- */
  if (legal.canCheck) {
    if (!legal.canRaise) return { type: 'check' };
    if (s >= 0.85 && rng.float() < p.slowplay) return { type: 'check' };
    if (s >= valueBar) {
      const strongEnough = s >= valueBar + 0.15;
      const freq = strongEnough ? 0.92 : opp === 1 ? 0.7 : 0.45;
      if (rng.float() < freq) return betPot(sizeFor(p.betSize.value < 0.35 ? 'small' : 'value'));
      return { type: 'check' };
    }
    if (street === 'flop' && pfAggressor === view.seat) {
      const dry = tex.wetness < 0.3 ? 1.1 : 0.85;
      const freq = (draw > 0.25 ? Math.max(p.cbet, p.semiBluff) : p.cbet) * mw * dry * (read.station ? 0.7 : 1);
      if (rng.float() < freq) return betPot(sizeFor(tex.wetness < 0.3 ? 'small' : 'bluff'));
      return { type: 'check' };
    }
    if (iBetLastStreet && street !== 'river') {
      const freq = (draw > 0.15 ? Math.max(p.barrel, p.semiBluff * 0.8) : p.barrel * (s < 0.2 ? 0.8 : 1)) * mw;
      if (rng.float() < freq) return betPot(sizeFor('bluff'));
      return { type: 'check' };
    }
    if (iBetLastStreet && street === 'river') {
      if (s < 0.25 && rng.float() < p.riverBarrel * mw * (read.station ? 0.3 : 1)) return betPot(sizeFor('bluff'));
      return { type: 'check' };
    }
    if (draw > 0.25 && rng.float() < p.semiBluff * 0.5 * mw) return betPot(sizeFor('bluff'));
    // The bettor from the last street has given up: take the pot away.
    const prevAggressor = lastAggressorOn(prevStreet);
    if (street !== 'flop' && prevAggressor !== null && prevAggressor !== view.seat && opp === 1) {
      const gaveUp = evs.some((e) => e.street === street && e.seat === prevAggressor && e.action === 'check');
      if (gaveUp && s < valueBar && rng.float() < p.bluff * 0.9 + 0.12) return betPot(sizeFor('bluff'));
    }
    // The last street was checked through: take a stab at it.
    if (street !== 'flop' && lastAggressorOn(prevStreet) === null && s < valueBar) {
      const stab = (bluffFreq * 0.7 + 0.08) * mw * (inPosition ? 1.2 : 0.7);
      if (rng.float() < stab) return betPot(sizeFor(s > 0.3 ? 'small' : 'bluff'));
    }
    if (s < 0.2 && rng.float() < bluffFreq * 0.45 * mw * (inPosition ? 1.3 : 0.8)) return betPot(sizeFor('bluff'));
    // Passive players sometimes lead small with a medium hand.
    if (s >= 0.3 && s < valueBar && p.stickiness > 0.6 && rng.float() < 0.12) return betPot(p.betSize.small);
    return { type: 'check' };
  }

  /* ---- Facing a bet ---- */
  const price = legal.callAmount / (pot + legal.callAmount);
  const bettor = [...evs].reverse().find((e) => e.action === 'bet' || e.action === 'raise');
  const bettorRead = bettor ? opponentRead(view, ctx, [bettor.seat]) : read;
  let bar =
    p.callThreshold +
    (price - 0.25) * 1.3 -
    Math.min(0.1, p.stickiness * 0.06 * streetIdx) +
    0.04 * (opp - 1) +
    (rng.float() - 0.5) * 0.08;
  if (scare && rng.float() < p.scareFold) bar += 0.22;
  if (bettorRead.nit) bar += 0.08;
  if (bettorRead.maniac) bar -= 0.06;
  if (legal.callAmount >= 0.6 * myStack) bar += 0.05 * (1 - p.stickiness);

  if (s >= p.raiseThreshold && legal.canRaise && rng.float() > p.slowplay * 0.6) {
    return raiseTo(view, legal, view.currentBet * p.raiseMult);
  }
  const drawCall = draw > 0 && (draw >= price * 0.85 || (p.stickiness > 0.6 && price < 0.4));
  if (draw >= 0.3 && legal.canRaise && opp === 1 && rng.float() < p.semiBluff * 0.3) {
    return raiseTo(view, legal, view.currentBet * p.raiseMult);
  }
  if (s < 0.15 && street !== 'river' && legal.canRaise && opp === 1 && rng.float() < bluffFreq * 0.1) {
    return raiseTo(view, legal, view.currentBet * p.raiseMult);
  }
  // Nobody calls a river bet with nothing at all.
  if (street === 'river') bar = Math.max(bar, 0.17);
  if (s >= bar || drawCall) return { type: 'call' };
  // Floating: calling a small flop bet in position, heads-up, planning to take it away later.
  if (street === 'flop' && price <= 0.34) {
    const float = Math.min(0.45, p.bluff * 0.7 + p.stickiness * 0.2 + (hr.outs >= 3 ? 0.15 : 0)) * (inPosition ? 1 : 0.6) * (opp === 1 ? 1 : 0.5);
    if (rng.float() < float) return { type: 'call' };
  }
  // Calling stations sometimes look you up with any pair on the river.
  if (street === 'river' && s >= 0.2 && p.stickiness > 0.7 && rng.float() < 0.35) return { type: 'call' };
  return check(legal);
}
