import { describe, expect, it } from 'vitest';
import { applyAction, currentPots, legalActions } from './hand';
import { act, makeHand, stackOf } from './testUtils';
import { IllegalActionError, type AwardEvent, type BetEvent, type HandState } from './types';

const six = { 0: 300, 1: 300, 2: 300, 3: 300, 4: 300, 5: 300 };
const awards = (s: HandState) => s.events.filter((e): e is AwardEvent => e.type === 'award');
const bets = (s: HandState) => s.events.filter((e): e is BetEvent => e.type === 'bet');

describe('blinds, positions and action order', () => {
  it('posts blinds and starts with UTG, 6-handed', () => {
    const s = makeHand({ stacks: six, button: 0, sb: 1, bb: 2 });
    expect(s.toAct).toBe(3);
    expect(s.players.map((p) => p.position)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']);
    expect(stackOf(s, 1)).toBe(299);
    expect(stackOf(s, 2)).toBe(297);
    expect(s.currentBet).toBe(3);
    expect(bets(s).map((e) => e.postKind)).toEqual(['sb', 'bb']);
  });

  it('gives the big blind the option after limps', () => {
    let s = makeHand({ stacks: six, button: 0, sb: 1, bb: 2 });
    s = act(s, 'c', 'c', 'c', 'c', 'c');
    expect(s.toAct).toBe(2);
    const legal = legalActions(s)!;
    expect(legal.canCheck).toBe(true);
    expect(legal.canRaise).toBe(true);
    s = act(s, 'x');
    expect(s.phase).toBe('flop');
    expect(s.board).toHaveLength(3);
    expect(s.toAct).toBe(1); // small blind acts first after the flop
  });

  it('lets the big blind raise when it has the option', () => {
    let s = makeHand({ stacks: six, button: 0, sb: 1, bb: 2 });
    s = act(s, 'c', 'f', 'f', 'f', 'f', 'r15');
    expect(s.toAct).toBe(3);
    expect(legalActions(s)!.facing).toBe(12);
  });

  it('heads-up: the button posts the small blind, acts first preflop and last after', () => {
    let s = makeHand({ stacks: { 0: 300, 1: 300 }, button: 0, sb: 0, bb: 1 });
    expect(s.players.map((p) => p.position)).toEqual(['BTN/SB', 'BB']);
    expect(s.toAct).toBe(0);
    s = act(s, 'c', 'x');
    expect(s.phase).toBe('flop');
    expect(s.toAct).toBe(1);
  });
});

describe('minimum bets and raises', () => {
  it('minimum open raise is to two big blinds', () => {
    const s = makeHand({ stacks: six, button: 0, sb: 1, bb: 2 });
    expect(legalActions(s)!.minTo).toBe(6);
  });

  it('minimum re-raise equals the previous raise size', () => {
    let s = makeHand({ stacks: six, button: 0, sb: 1, bb: 2 });
    s = act(s, 'r10'); // raise of 7
    expect(legalActions(s)!.minTo).toBe(17);
    expect(() => act(s, 'r16')).toThrow('Minimum raise is to $17');
    s = act(s, 'r17');
    expect(legalActions(s)!.minTo).toBe(24);
    s = act(s, 'r50'); // raise of 33
    expect(legalActions(s)!.minTo).toBe(83);
  });

  it('minimum bet after the flop is the big blind', () => {
    let s = makeHand({ stacks: six, button: 0, sb: 1, bb: 2 });
    s = act(s, 'c', 'c', 'c', 'c', 'c', 'x');
    const legal = legalActions(s)!;
    expect(legal.isBet).toBe(true);
    expect(legal.minTo).toBe(3);
    expect(() => act(s, 'b2')).toThrow('Minimum bet is to $3');
  });

  it('a player with fewer chips than a min raise can still go all-in', () => {
    let s = makeHand({ stacks: { 0: 300, 1: 300, 2: 300, 3: 12 }, button: 0, sb: 1, bb: 2 });
    s = act(s, 'c', 'r10', 'f', 'f'); // UTG limps, BTN raises to 10, blinds fold
    expect(s.toAct).toBe(3);
    const legal = legalActions(s)!;
    expect(legal.canRaise).toBe(true);
    expect(legal.minTo).toBe(12);
    expect(legal.maxTo).toBe(12);
  });
});

describe('all-ins for less than a full raise', () => {
  // Blinds $5/$10. Seats: 0 BTN, 1 SB, 2 BB, 3 UTG. Everyone limps, then flop action.
  const limpToFlop = (stacks: Record<number, number>) =>
    act(makeHand({ stacks, button: 0, sb: 1, bb: 2, blinds: [5, 10] }), 'c', 'c', 'c', 'x');

  it('does not reopen the betting for players who already acted', () => {
    let s = limpToFlop({ 0: 1000, 1: 1000, 2: 1000, 3: 160 });
    expect(s.toAct).toBe(1);
    s = act(s, 'b100', 'c', 'a'); // SB bets 100, BB calls, UTG all-in for 150
    const shortAllIn = bets(s).at(-1)!;
    expect(shortAllIn.toAmount).toBe(150);
    expect(shortAllIn.fullRaise).toBe(false);

    // The button has not acted yet, so it may raise: minimum is 150 + 100.
    expect(s.toAct).toBe(0);
    expect(legalActions(s)!.canRaise).toBe(true);
    expect(legalActions(s)!.minTo).toBe(250);
    s = act(s, 'c');

    // Back to the original bettor: call or fold only.
    expect(s.toAct).toBe(1);
    const legal = legalActions(s)!;
    expect(legal.canRaise).toBe(false);
    expect(legal.callAmount).toBe(50);
    expect(() => applyAction(s, 1, { type: 'raise', to: 300 })).toThrow(IllegalActionError);
    s = act(s, 'c');
    expect(legalActions(s)!.canRaise).toBe(false); // BB too
    s = act(s, 'c');
    expect(s.phase).toBe('turn');
  });

  it('several short all-ins adding up to a full raise do reopen the betting', () => {
    let s = limpToFlop({ 0: 1000, 1: 1000, 2: 160, 3: 230 });
    s = act(s, 'b100', 'a', 'a'); // BB all-in 150 (+50), UTG all-in 220 (+70)
    expect(bets(s).at(-1)!.fullRaise).toBe(false);
    s = act(s, 'c'); // button calls 220
    expect(s.toAct).toBe(1);
    const legal = legalActions(s)!;
    expect(legal.facing).toBe(120); // at least a full raise (100) since the SB acted
    expect(legal.canRaise).toBe(true);
    expect(legal.minTo).toBe(320);
  });

  it('players must call the full big blind when the big blind is short', () => {
    let s = makeHand({ stacks: { 0: 300, 1: 300, 2: 2, 3: 300 }, button: 0, sb: 1, bb: 2 });
    expect(s.players.find((p) => p.seat === 2)!.allIn).toBe(true);
    expect(s.currentBet).toBe(3);
    expect(legalActions(s)!.callAmount).toBe(3);
    s = act(s, 'c', 'f', 'c'); // UTG calls 3, BTN folds, SB completes
    expect(s.phase).toBe('flop');
    expect(currentPots(s)).toEqual([
      { amount: 6, eligible: [1, 2, 3] },
      { amount: 2, eligible: [1, 3] },
    ]);
  });
});

describe('uncalled bets', () => {
  it('returns the uncalled part of a raise when everyone folds', () => {
    let s = makeHand({ stacks: { 0: 300, 1: 300, 2: 300 }, button: 0, sb: 1, bb: 2 });
    s = act(s, 'r10', 'f', 'f');
    expect(s.phase).toBe('complete');
    expect(s.events.find((e) => e.type === 'uncalled')).toMatchObject({ seat: 0, amount: 7 });
    expect(stackOf(s, 0)).toBe(304);
    expect(s.result!.net).toEqual({ 0: 4, 1: -1, 2: -3 });
    expect(s.result!.wentToShowdown).toBe(false);
  });

  it('returns the excess when a bigger stack is called all-in', () => {
    let s = makeHand({ stacks: { 0: 500, 1: 300, 2: 120 }, button: 0, sb: 1, bb: 2, holes: { 0: 'Ac Ad', 2: 'Kc Kd' }, board: '2s 7h 9c 4d Js' });
    s = act(s, 'a', 'f', 'a'); // BTN shoves 500, SB folds, BB calls all-in for 120
    expect(s.events.find((e) => e.type === 'uncalled')).toMatchObject({ seat: 0, amount: 380 });
    expect(s.phase).toBe('complete');
    expect(stackOf(s, 0)).toBe(500 + 120 + 1);
  });

  it('cannot raise when every opponent is all-in, so all-in just calls', () => {
    let s = makeHand({ stacks: { 0: 500, 1: 300, 2: 120 }, button: 0, sb: 1, bb: 2 });
    s = act(s, 'r40', 'f', 'a'); // BB re-shoves 120
    const legal = legalActions(s)!;
    expect(legal.canRaise).toBe(false);
    expect(legal.raiseBlockedReason).toBe('All opponents are all-in');
    s = act(s, 'a');
    expect(bets(s).at(-1)).toMatchObject({ seat: 0, action: 'call', amount: 80, allIn: false });
  });
});

describe('side pots', () => {
  // Blinds $5/$10. Seat 0 BTN ($300), 1 SB ($50), 2 BB ($150).
  it('builds main and side pots from three different all-ins', () => {
    let s = makeHand({
      stacks: { 0: 300, 1: 50, 2: 150 },
      button: 0, sb: 1, bb: 2, blinds: [5, 10],
      holes: { 1: 'Ac Ad', 2: 'Kc Kd', 0: 'Qc Qd' },
      board: '2s 7h 9c 4d 3s',
    });
    s = act(s, 'a', 'a', 'a');
    expect(s.phase).toBe('complete');
    expect(s.ranOut).toBe(true);
    expect(s.result!.pots).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 200, eligible: [0, 2] },
    ]);
    expect(awards(s).map((a) => [a.seat, a.amount, a.potIndex])).toEqual([[1, 150, 0], [2, 200, 1]]);
    expect([stackOf(s, 0), stackOf(s, 1), stackOf(s, 2)]).toEqual([150, 150, 200]);
    // All-in runout: every hand is shown.
    expect(s.events.filter((e) => e.type === 'show')).toHaveLength(3);
  });

  it('includes a folded player’s chips without letting them win', () => {
    let s = makeHand({
      stacks: { 0: 300, 1: 50, 2: 150, 3: 500 },
      button: 0, sb: 1, bb: 2, blinds: [5, 10],
      holes: { 1: 'Ac Ad', 2: 'Kc Kd', 0: 'Qc Qd', 3: 'Jc Jd' },
      board: '2s 7h 9c 4d 3s',
    });
    s = act(s, 'c', 'a', 'a', 'a', 'f'); // UTG limps, BTN shoves, SB and BB call all-in, UTG folds
    expect(s.result!.pots).toEqual([
      { amount: 160, eligible: [0, 1, 2] },
      { amount: 200, eligible: [0, 2] },
    ]);
    expect(stackOf(s, 3)).toBe(490);
    expect(s.result!.winnings).toEqual({ 1: 160, 2: 200 });
  });

  it('the best hand wins only the pots it is eligible for', () => {
    let s = makeHand({
      stacks: { 0: 300, 1: 50, 2: 150 },
      button: 0, sb: 1, bb: 2, blinds: [5, 10],
      holes: { 1: 'Ac Ad', 2: 'Qc Qd', 0: 'Kc Kd' },
      board: '2s 7h 9c 4d 3s',
    });
    s = act(s, 'a', 'a', 'a');
    expect(s.result!.winnings).toEqual({ 1: 150, 0: 200 });
    expect(stackOf(s, 0)).toBe(350);
  });
});

describe('split pots and odd chips', () => {
  it('gives the odd chip to the first winner left of the button', () => {
    let s = makeHand({
      stacks: { 0: 100, 1: 100, 2: 100 },
      button: 0, sb: 1, bb: 2,
      holes: { 0: '2c 3d', 2: '4c 5d' },
      board: 'As Ks Qs Js Ts',
    });
    s = act(s, 'c', 'f', 'x', 'x', 'x', 'x', 'x', 'x', 'x');
    expect(s.result!.pots).toEqual([{ amount: 7, eligible: [0, 2] }]);
    expect(s.result!.winnings).toEqual({ 2: 4, 0: 3 });
  });

  it('splits three ways with the remainder going clockwise from the button', () => {
    let s = makeHand({
      stacks: { 0: 100, 1: 100, 2: 100, 3: 100 },
      button: 0, sb: 1, bb: 2,
      holes: { 0: '2c 3d', 2: '4c 5d', 3: '6c 7d' },
      board: 'As Ks Qs Js Ts',
    });
    s = act(s, 'c', 'c', 'f', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x');
    expect(s.result!.winnings).toEqual({ 2: 4, 3: 3, 0: 3 });
  });
});

describe('straddles and live posts', () => {
  it('UTG straddle: action starts left of the straddler, min raise is to 4 BB, straddler has the option', () => {
    let s = makeHand({ stacks: six, button: 0, sb: 1, bb: 2, straddle: 3 });
    expect(bets(s).map((e) => [e.postKind, e.amount])).toEqual([['sb', 1], ['bb', 3], ['straddle', 6]]);
    expect(s.toAct).toBe(4);
    expect(legalActions(s)!.minTo).toBe(12);
    s = act(s, 'c', 'c', 'c', 'c', 'c');
    expect(s.toAct).toBe(3);
    expect(legalActions(s)!.canCheck).toBe(true);
    expect(legalActions(s)!.canRaise).toBe(true);
    s = act(s, 'x');
    expect(s.phase).toBe('flop');
  });

  it('a new player who posts a live big blind gets the option', () => {
    let s = makeHand({ stacks: { 0: 300, 1: 300, 2: 300, 3: 300, 4: 300 }, button: 0, sb: 1, bb: 2, livePosters: [4] });
    expect(bets(s).map((e) => e.postKind)).toEqual(['sb', 'bb', 'live-bb']);
    s = act(s, 'c');
    expect(s.toAct).toBe(4);
    expect(legalActions(s)!.canCheck).toBe(true);
    s = act(s, 'x', 'c', 'c', 'x');
    expect(s.phase).toBe('flop');
    expect(s.players.reduce((a, p) => a + p.totalCommitted, 0)).toBe(15);
  });
});

describe('rake', () => {
  const rake = { enabled: true, percent: 10, cap: 5, noFlopNoDrop: true };
  it('no flop, no drop', () => {
    const s = act(makeHand({ stacks: { 0: 300, 1: 300, 2: 300 }, button: 0, sb: 1, bb: 2, rake }), 'r10', 'f', 'f');
    expect(s.result!.rake).toBe(0);
  });
  it('takes 10% up to the cap once a flop is dealt', () => {
    let s = makeHand({ stacks: { 0: 300, 1: 300, 2: 300 }, button: 0, sb: 1, bb: 2, rake });
    s = act(s, 'r30', 'c', 'c', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x');
    expect(s.result!.rake).toBe(5);
    const total = s.players.reduce((a, p) => a + p.stack, 0);
    expect(total).toBe(895);
  });
  it('is off by default', () => {
    let s = makeHand({ stacks: { 0: 300, 1: 300, 2: 300 }, button: 0, sb: 1, bb: 2 });
    s = act(s, 'r30', 'c', 'c', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x');
    expect(s.result!.rake).toBe(0);
  });
});

describe('showdown order and mucking', () => {
  it('the river bettor shows first; a beaten caller mucks', () => {
    let s = makeHand({
      stacks: { 0: 300, 1: 300 }, button: 0, sb: 0, bb: 1,
      holes: { 1: 'Ac Ad', 0: 'Kc Kd' }, board: '2s 7h 9c 4d Js',
    });
    s = act(s, 'c', 'x', 'x', 'x', 'x', 'x', 'b10', 'c');
    const sd = s.events.filter((e) => e.type === 'show' || e.type === 'muck').map((e) => [e.type, e.seat]);
    expect(sd).toEqual([['show', 1], ['muck', 0]]);
    expect(s.result!.winnings).toEqual({ 1: 26 });
  });

  it('when the river checks through, the first player left of the button shows first', () => {
    let s = makeHand({
      stacks: { 0: 300, 1: 300, 2: 300 }, button: 0, sb: 1, bb: 2,
      holes: { 1: 'Ac Ad', 2: 'Kc Kd', 0: '2c 3d' }, board: '9s 7h 5c Jd Qs',
    });
    s = act(s, 'c', 'c', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x');
    const sd = s.events.filter((e) => e.type === 'show' || e.type === 'muck').map((e) => [e.type, e.seat]);
    expect(sd).toEqual([['show', 1], ['muck', 2], ['muck', 0]]);
  });

  it('a player who ties shows and splits', () => {
    let s = makeHand({
      stacks: { 0: 300, 1: 300 }, button: 0, sb: 0, bb: 1,
      holes: { 1: 'Ac 2d', 0: 'Ad 3c' }, board: 'Ks Kh Qd Qc Js',
    });
    s = act(s, 'c', 'x', 'x', 'x', 'x', 'x', 'x', 'x');
    expect(s.events.filter((e) => e.type === 'show')).toHaveLength(2);
    expect(s.result!.winnings).toEqual({ 1: 3, 0: 3 });
  });
});

describe('illegal actions are rejected', () => {
  const fresh = () => makeHand({ stacks: six, button: 0, sb: 1, bb: 2 });
  it('acting out of turn', () => {
    expect(() => applyAction(fresh(), 4, { type: 'call' })).toThrow("It is not seat 4's turn");
  });
  it('checking when facing a bet', () => {
    expect(() => act(fresh(), 'x')).toThrow('Cannot check');
  });
  it('calling when there is nothing to call', () => {
    const s = act(fresh(), 'c', 'c', 'c', 'c', 'c');
    expect(() => act(s, 'c')).toThrow('Nothing to call');
  });
  it('fractional or oversized bets', () => {
    expect(() => applyAction(fresh(), 3, { type: 'raise', to: 7.5 })).toThrow('whole dollars');
    expect(() => applyAction(fresh(), 3, { type: 'raise', to: 301 })).toThrow('Maximum is $300');
  });
  it('acting after the hand is over', () => {
    const s = act(fresh(), 'f', 'f', 'f', 'f', 'f');
    expect(s.phase).toBe('complete');
    expect(() => applyAction(s, 2, { type: 'check' })).toThrow('The hand is over');
  });
});

describe('action records for the hand history', () => {
  it('records amount added, raise-to, facing, pot and stack before/after', () => {
    let s = makeHand({ stacks: six, button: 0, sb: 1, bb: 2 });
    s = act(s, 'r15', 'f', 'f', 'c', 'c', 'c');
    const [, , raise, fold, , , sbCall, bbCall] = bets(s);
    expect(raise).toMatchObject({ seat: 3, action: 'raise', amount: 15, toAmount: 15, facing: 3, potBefore: 4, potAfter: 19, stackBefore: 300, stackAfter: 285 });
    expect(fold).toMatchObject({ seat: 4, action: 'fold', amount: 0, facing: 15 });
    expect(sbCall).toMatchObject({ seat: 1, action: 'call', amount: 14, toAmount: 15, facing: 14, stackBefore: 299, stackAfter: 285 });
    expect(bbCall).toMatchObject({ seat: 2, action: 'call', amount: 12, facing: 12, potBefore: 48, potAfter: 60 });
    expect(s.events.find((e) => e.type === 'street')).toMatchObject({ street: 'flop', pot: 60 });
  });

  it('an all-in shove that only calls is recorded as a call', () => {
    let s = makeHand({ stacks: { 0: 300, 1: 300, 2: 50 }, button: 0, sb: 1, bb: 2 });
    s = act(s, 'r100', 'f', 'a');
    expect(bets(s).at(-1)).toMatchObject({ action: 'call', allIn: true, amount: 47 });
  });
});
