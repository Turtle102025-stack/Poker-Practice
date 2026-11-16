import type { Card } from './cards';
import { evaluate, describeHand, type HandValue } from './evaluator';
import { labelPositions } from './positions';
import { buildPots, computeRake, splitPot, takeRake } from './pots';
import {
  IllegalActionError,
  type AwardEvent,
  type BetEvent,
  type HandConfig,
  type HandEvent,
  type HandResult,
  type HandState,
  type LegalActions,
  type PlayerAction,
  type PlayerState,
  type PostKind,
  type Street,
} from './types';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function cloneState(s: HandState): HandState {
  return {
    ...s,
    board: s.board.slice(),
    players: s.players.map((p) => ({ ...p })),
    events: s.events.slice(),
  };
}

function player(s: HandState, seat: number): PlayerState {
  const p = s.players.find((x) => x.seat === seat);
  if (!p) throw new Error(`No player in seat ${seat}`);
  return p;
}

export function potTotal(s: HandState): number {
  let t = 0;
  for (const p of s.players) t += p.totalCommitted;
  return t;
}

/** Players clockwise starting with the first seat after `fromSeat`. */
export function clockwiseFrom(players: readonly PlayerState[], fromSeat: number): PlayerState[] {
  const after = players.filter((p) => p.seat > fromSeat);
  const before = players.filter((p) => p.seat <= fromSeat);
  return [...after, ...before];
}

function nextMatching(
  s: HandState,
  fromSeat: number,
  pred: (p: PlayerState) => boolean,
): PlayerState | undefined {
  return clockwiseFrom(s.players, fromSeat).find(pred);
}

function currentStreet(s: HandState): Street {
  const n = s.board.length;
  return n === 0 ? 'preflop' : n === 3 ? 'flop' : n === 4 ? 'turn' : 'river';
}

function isWhole(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/**
 * The order cards come off the deck: hole cards (one at a time, two passes,
 * starting left of the button), then burn + flop, burn + turn, burn + river.
 */
export function dealOrder(config: HandConfig): Array<{ kind: 'hole'; seat: number } | { kind: 'burn' | 'board' }> {
  const seats = config.players.map((p) => p.seat).sort((a, b) => a - b);
  const after = seats.filter((x) => x > config.buttonSeat);
  const before = seats.filter((x) => x <= config.buttonSeat);
  const order = [...after, ...before];
  const out: Array<{ kind: 'hole'; seat: number } | { kind: 'burn' | 'board' }> = [];
  for (let pass = 0; pass < 2; pass++) for (const seat of order) out.push({ kind: 'hole', seat });
  out.push({ kind: 'burn' }, { kind: 'board' }, { kind: 'board' }, { kind: 'board' });
  out.push({ kind: 'burn' }, { kind: 'board' }, { kind: 'burn' }, { kind: 'board' });
  return out;
}

/* ------------------------------------------------------------------ */
/* Starting a hand                                                     */
/* ------------------------------------------------------------------ */

function validateConfig(c: HandConfig): void {
  const seats = c.players.map((p) => p.seat);
  if (c.players.length < 2) throw new Error('Need at least 2 players');
  if (new Set(seats).size !== seats.length) throw new Error('Duplicate seats');
  for (const p of c.players) {
    if (p.seat < 0 || p.seat >= c.numSeats) throw new Error(`Seat ${p.seat} out of range`);
    if (!isWhole(p.stack) || p.stack <= 0) throw new Error(`Bad stack for ${p.name}`);
  }
  if (!isWhole(c.smallBlind) || !isWhole(c.bigBlind) || c.bigBlind <= 0 || c.smallBlind > c.bigBlind) {
    throw new Error('Bad blinds');
  }
  if (!seats.includes(c.bbSeat)) throw new Error('Big blind seat is not dealt in');
  if (c.sbSeat !== null && !seats.includes(c.sbSeat)) throw new Error('Small blind seat is not dealt in');
  if (c.sbSeat === c.bbSeat) throw new Error('Small blind and big blind are the same seat');
  if (c.players.length === 2 && c.sbSeat !== c.buttonSeat) {
    throw new Error('Heads-up: the button must post the small blind');
  }
  if (c.players.length > 2 && (c.buttonSeat === c.sbSeat || c.buttonSeat === c.bbSeat)) {
    throw new Error('The button cannot also be a blind when 3+ players are dealt in');
  }
  for (const lp of c.livePosters ?? []) {
    if (!seats.includes(lp) || lp === c.bbSeat || lp === c.sbSeat) throw new Error('Bad live poster');
  }
  if (c.straddleSeat != null) {
    if (!seats.includes(c.straddleSeat)) throw new Error('Straddler is not dealt in');
    if (c.players.length < 4) throw new Error('Straddles need at least 4 players');
    const sp = c.players.find((p) => p.seat === c.straddleSeat)!;
    if (sp.stack <= 2 * c.bigBlind) throw new Error('Straddler does not have enough chips');
    if ((c.livePosters ?? []).includes(c.straddleSeat)) throw new Error('A live poster cannot straddle');
  }
}

/**
 * Starts a hand: posts blinds (and any live posts / straddle), deals hole cards,
 * and sets the first player to act. `deck` must be a full shuffled deck.
 */
export function startHand(config: HandConfig, deck: readonly Card[]): HandState {
  validateConfig(config);
  if (deck.length !== 52 || new Set(deck).size !== 52) throw new Error('Deck must contain 52 distinct cards');

  const sorted = config.players.slice().sort((a, b) => a.seat - b.seat);
  const orderFromButton = [
    ...sorted.filter((p) => p.seat > config.buttonSeat),
    ...sorted.filter((p) => p.seat <= config.buttonSeat),
  ].map((p) => p.seat);
  const buttonIsLive = sorted.some((p) => p.seat === config.buttonSeat);
  const labels = labelPositions({
    orderFromButton,
    buttonSeat: buttonIsLive ? config.buttonSeat : null,
    sbSeat: config.sbSeat,
    bbSeat: config.bbSeat,
  });

  const s: HandState = {
    config,
    deck: deck.slice(),
    deckPos: 0,
    board: [],
    players: sorted.map((p) => ({
      seat: p.seat,
      id: p.id,
      name: p.name,
      startStack: p.stack,
      stack: p.stack,
      hole: [],
      committed: 0,
      totalCommitted: 0,
      folded: false,
      allIn: false,
      hasActed: false,
      position: labels.get(p.seat)!,
      shown: false,
      mucked: false,
    })),
    phase: 'preflop',
    currentBet: 0,
    minRaise: config.bigBlind,
    toAct: null,
    lastAggressor: null,
    ranOut: false,
    events: [],
    result: null,
  };

  // Forced bets.
  if (config.sbSeat !== null) post(s, config.sbSeat, config.smallBlind, 'sb');
  post(s, config.bbSeat, config.bigBlind, 'bb');
  const posters = clockwiseFrom(s.players, config.bbSeat)
    .filter((p) => (config.livePosters ?? []).includes(p.seat))
    .map((p) => p.seat);
  for (const seat of posters) post(s, seat, config.bigBlind, 'live-bb');
  const straddle = config.straddleSeat ?? null;
  if (straddle !== null) post(s, straddle, 2 * config.bigBlind, 'straddle');

  // Players must match the full blind (or straddle) even if a blind was posted short.
  s.currentBet = straddle !== null ? 2 * config.bigBlind : config.bigBlind;
  s.minRaise = s.currentBet;

  // Deal hole cards.
  for (const step of dealOrder(config)) {
    if (step.kind !== 'hole') break;
    player(s, step.seat).hole.push(s.deck[s.deckPos++]);
  }

  return advance(s, straddle ?? config.bbSeat);
}

function post(s: HandState, seat: number, blind: number, kind: PostKind): void {
  const p = player(s, seat);
  const amount = Math.min(blind, p.stack);
  const potBefore = potTotal(s);
  const stackBefore = p.stack;
  p.stack -= amount;
  p.committed += amount;
  p.totalCommitted += amount;
  p.allIn = p.stack === 0;
  const ev: BetEvent = {
    type: 'bet',
    seat,
    street: 'preflop',
    action: 'post',
    postKind: kind,
    amount,
    toAmount: p.committed,
    facing: 0,
    allIn: p.allIn,
    potBefore,
    potAfter: potBefore + amount,
    stackBefore,
    stackAfter: p.stack,
    board: [],
  };
  s.events.push(ev);
}

/* ------------------------------------------------------------------ */
/* Legal actions                                                       */
/* ------------------------------------------------------------------ */

export function legalActions(s: HandState): LegalActions | null {
  if (s.phase === 'complete' || s.toAct === null) return null;
  const p = player(s, s.toAct);
  const facing = Math.max(0, s.currentBet - p.committed);
  const callAmount = Math.min(facing, p.stack);
  const maxTo = p.committed + p.stack;
  const isBet = s.currentBet === 0;
  const fullMinTo = s.currentBet + s.minRaise;

  let canRaise = true;
  let reason: string | undefined;
  const opponentsWithChips = s.players.filter(
    (o) => o.seat !== p.seat && !o.folded && !o.allIn,
  ).length;
  if (maxTo <= s.currentBet) {
    canRaise = false;
    reason = 'Not enough chips to raise';
  } else if (opponentsWithChips === 0) {
    canRaise = false;
    reason = 'All opponents are all-in';
  } else if (p.hasActed && facing < s.minRaise) {
    // An all-in for less than a full raise does not reopen the betting
    // to a player who has already acted.
    canRaise = false;
    reason = 'Betting was not reopened (all-in was less than a full raise)';
  }

  return {
    seat: p.seat,
    canFold: true,
    canCheck: facing === 0,
    canCall: facing > 0,
    callAmount,
    facing,
    canRaise,
    isBet,
    minTo: canRaise ? Math.min(fullMinTo, maxTo) : 0,
    maxTo: canRaise ? maxTo : 0,
    raiseBlockedReason: reason,
  };
}

/* ------------------------------------------------------------------ */
/* Applying an action                                                  */
/* ------------------------------------------------------------------ */

/**
 * Applies `action` for the player in `seat` and returns the new state.
 * Throws IllegalActionError if it is not that player's turn or the action is illegal.
 */
export function applyAction(state: HandState, seat: number, action: PlayerAction): HandState {
  if (state.phase === 'complete') throw new IllegalActionError('The hand is over');
  if (state.toAct !== seat) throw new IllegalActionError(`It is not seat ${seat}'s turn`);
  const legal = legalActions(state)!;
  const s = cloneState(state);
  const p = player(s, seat);
  const street = currentStreet(s);
  const potBefore = potTotal(s);
  const stackBefore = p.stack;

  let resolved = action;
  if (action.type === 'allin') {
    if (legal.canRaise && legal.maxTo > s.currentBet) resolved = { type: 'raise', to: legal.maxTo };
    else if (legal.canCall) resolved = { type: 'call' };
    else resolved = { type: 'check' };
  }

  let kind: BetEvent['action'];
  let added = 0;
  let fullRaise: boolean | undefined;

  switch (resolved.type) {
    case 'fold':
      p.folded = true;
      kind = 'fold';
      break;
    case 'check':
      if (!legal.canCheck) throw new IllegalActionError(`Cannot check: $${legal.facing} to call`);
      kind = 'check';
      break;
    case 'call':
      if (!legal.canCall) throw new IllegalActionError('Nothing to call');
      added = legal.callAmount;
      kind = 'call';
      break;
    case 'bet':
    case 'raise': {
      if (!legal.canRaise) throw new IllegalActionError(legal.raiseBlockedReason ?? 'Cannot raise');
      const to = resolved.to;
      if (!Number.isInteger(to)) throw new IllegalActionError('Bet amounts must be whole dollars');
      if (to < legal.minTo) {
        throw new IllegalActionError(`Minimum ${legal.isBet ? 'bet' : 'raise'} is to $${legal.minTo}`);
      }
      if (to > legal.maxTo) throw new IllegalActionError(`Maximum is $${legal.maxTo} (all-in)`);
      added = to - p.committed;
      const increment = to - s.currentBet;
      fullRaise = increment >= s.minRaise;
      if (fullRaise) s.minRaise = increment;
      s.currentBet = to;
      s.lastAggressor = seat;
      kind = legal.isBet ? 'bet' : 'raise';
      break;
    }
    default:
      throw new IllegalActionError('Unknown action');
  }

  p.stack -= added;
  p.committed += added;
  p.totalCommitted += added;
  p.allIn = p.stack === 0 && !p.folded;
  p.hasActed = true;

  s.events.push({
    type: 'bet',
    seat,
    street,
    action: kind,
    amount: added,
    toAmount: p.committed,
    facing: legal.facing,
    allIn: p.allIn,
    fullRaise,
    potBefore,
    potAfter: potBefore + added,
    stackBefore,
    stackAfter: p.stack,
    board: s.board.slice(),
  });

  return advance(s, seat);
}

/* ------------------------------------------------------------------ */
/* Moving the hand forward                                             */
/* ------------------------------------------------------------------ */

/** Finds the next player to act after `fromSeat`, or ends the betting round. Mutates `s`. */
function advance(s: HandState, fromSeat: number): HandState {
  const live = s.players.filter((p) => !p.folded);
  if (live.length === 1) {
    returnUncalled(s);
    finishWithoutShowdown(s, live[0]);
    return s;
  }
  const actionable = live.filter((p) => !p.allIn);
  const needsToAct = (p: PlayerState) =>
    !p.folded && !p.allIn && (p.committed < s.currentBet || (!p.hasActed && actionable.length > 1));
  const next = nextMatching(s, fromSeat, needsToAct);
  if (next) {
    s.toAct = next.seat;
    return s;
  }
  // Betting round complete.
  s.toAct = null;
  returnUncalled(s);
  nextStreetOrShowdown(s);
  return s;
}

function returnUncalled(s: HandState): void {
  const byCommit = s.players.slice().sort((a, b) => b.committed - a.committed);
  const top = byCommit[0];
  const second = byCommit[1]?.committed ?? 0;
  const diff = top.committed - second;
  if (diff > 0) {
    top.committed -= diff;
    top.totalCommitted -= diff;
    top.stack += diff;
    top.allIn = false;
    s.events.push({ type: 'uncalled', seat: top.seat, street: currentStreet(s), amount: diff });
  }
}

function nextStreetOrShowdown(s: HandState): void {
  for (;;) {
    if (s.board.length === 5) {
      showdown(s);
      return;
    }
    for (const p of s.players) {
      p.committed = 0;
      p.hasActed = false;
    }
    s.currentBet = 0;
    s.minRaise = s.config.bigBlind;

    const count = s.board.length === 0 ? 3 : 1;
    s.deckPos++; // burn
    const cards = s.deck.slice(s.deckPos, s.deckPos + count);
    s.deckPos += count;
    s.board.push(...cards);
    const street = currentStreet(s);
    s.phase = street;
    s.events.push({ type: 'street', street, cards, board: s.board.slice(), pot: potTotal(s) });

    const actionable = s.players.filter((p) => !p.folded && !p.allIn);
    if (actionable.length >= 2) {
      s.lastAggressor = null;
      s.toAct = nextMatching(s, s.config.buttonSeat, (p) => !p.folded && !p.allIn)!.seat;
      return;
    }
    // Nobody left to bet: run out the board.
    s.ranOut = true;
  }
}

function finishWithoutShowdown(s: HandState, winner: PlayerState): void {
  const pots = buildPots(s.players);
  const total = pots.reduce((a, p) => a + p.amount, 0);
  const rake = computeRake(total, s.board.length >= 3, s.config.rake);
  takeRake(pots, rake);
  if (rake > 0) s.events.push({ type: 'rake', amount: rake });
  const winnings: Record<number, number> = {};
  pots.forEach((pot, i) => {
    if (pot.amount <= 0) return;
    winner.stack += pot.amount;
    winnings[winner.seat] = (winnings[winner.seat] ?? 0) + pot.amount;
    s.events.push({ type: 'award', seat: winner.seat, amount: pot.amount, potIndex: i, potCount: pots.length });
  });
  complete(s, pots, rake, winnings, false);
}

function showdown(s: HandState): void {
  s.toAct = null;
  const live = s.players.filter((p) => !p.folded);
  const pots = buildPots(s.players);
  const total = pots.reduce((a, p) => a + p.amount, 0);
  const rake = computeRake(total, true, s.config.rake);
  takeRake(pots, rake);
  if (rake > 0) s.events.push({ type: 'rake', amount: rake });

  const values = new Map<number, HandValue>();
  for (const p of live) values.set(p.seat, evaluate([...p.hole, ...s.board]));

  // Showing order: last aggressor first, otherwise first live player left of the button.
  const first =
    s.lastAggressor !== null && live.some((p) => p.seat === s.lastAggressor)
      ? s.lastAggressor
      : nextMatching(s, s.config.buttonSeat, (p) => !p.folded)!.seat;
  const order = [player(s, first), ...clockwiseFrom(live, first).filter((p) => p.seat !== first)];

  // A player shows if all hands are tabled (all-in runout), if they are first,
  // or if they can win or tie a contested pot against the hands already shown.
  const contested = pots.filter((pot) => pot.eligible.length >= 2);
  const shownSeats: number[] = [];
  for (const p of order) {
    const v = values.get(p.seat)!;
    let show = s.ranOut || shownSeats.length === 0;
    if (!show) {
      for (const pot of contested) {
        if (!pot.eligible.includes(p.seat)) continue;
        const rivals = shownSeats.filter((x) => pot.eligible.includes(x));
        if (rivals.length === 0 || rivals.every((x) => v >= values.get(x)!)) {
          show = true;
          break;
        }
      }
    }
    if (show) {
      p.shown = true;
      shownSeats.push(p.seat);
      s.events.push({ type: 'show', seat: p.seat, cards: p.hole.slice(), value: v, description: describeHand(v) });
    } else {
      p.mucked = true;
      s.events.push({ type: 'muck', seat: p.seat });
    }
  }

  const winnings: Record<number, number> = {};
  pots.forEach((pot, i) => {
    if (pot.amount <= 0) return;
    let contenders = pot.eligible.filter((x) => shownSeats.includes(x));
    if (contenders.length === 0) contenders = pot.eligible; // uncontested pot
    const best = Math.max(...contenders.map((x) => values.get(x)!));
    const winnersInOrder = clockwiseFrom(s.players, s.config.buttonSeat)
      .map((p) => p.seat)
      .filter((x) => contenders.includes(x) && values.get(x) === best);
    const shares = splitPot(pot.amount, winnersInOrder);
    for (const [seat, amount] of shares) {
      player(s, seat).stack += amount;
      winnings[seat] = (winnings[seat] ?? 0) + amount;
      const ev: AwardEvent = { type: 'award', seat, amount, potIndex: i, potCount: pots.length };
      if (pot.eligible.length >= 2) ev.description = describeHand(values.get(seat)!);
      s.events.push(ev);
    }
  });
  complete(s, pots, rake, winnings, true);
}

function complete(
  s: HandState,
  pots: HandResult['pots'],
  rake: number,
  winnings: Record<number, number>,
  wentToShowdown: boolean,
): void {
  for (const p of s.players) {
    p.committed = 0;
  }
  const net: Record<number, number> = {};
  for (const p of s.players) net[p.seat] = p.stack - p.startStack;
  s.phase = 'complete';
  s.toAct = null;
  s.result = { pots, rake, winnings, net, wentToShowdown };
}

/* ------------------------------------------------------------------ */
/* Queries used by the UI and AI                                       */
/* ------------------------------------------------------------------ */

/** Pots as they stand right now (bets from earlier streets, split by all-ins). */
export function currentPots(s: HandState): { amount: number; eligible: number[] }[] {
  if (s.result) return s.result.pots;
  const settled = s.players.map((p) => ({ ...p, totalCommitted: p.totalCommitted - p.committed }));
  return buildPots(settled);
}

export function getPlayer(s: HandState, seat: number): PlayerState {
  return player(s, seat);
}

export function isComplete(s: HandState): boolean {
  return s.phase === 'complete';
}

export type { HandEvent };
