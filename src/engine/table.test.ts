import { describe, expect, it } from 'vitest';
import { startHand } from './hand';
import { shuffledDeck } from './deck';
import { labelPositions } from './positions';
import { seededRng } from './rng';
import { NEW_BUTTON_STATE, planNextHand, type ButtonState, type TableSeatInfo } from './table';

const rng = seededRng(1);
const seats = (spec: Record<number, TableSeatInfo['status']>): TableSeatInfo[] =>
  Object.entries(spec).map(([seat, status]) => ({ seat: Number(seat), stack: 100, status }));
const plan = (spec: Record<number, TableSeatInfo['status']>, state: ButtonState, first?: number) =>
  planNextHand(seats(spec), 10, state, rng, first)!;

describe('position labels', () => {
  const order = (n: number) => Array.from({ length: n }, (_, i) => i + 1).map((x) => x % n);
  const labels = (n: number) => {
    // Seats 0..n-1, button on seat 0: order from button is 1,2,...,n-1,0.
    const m = labelPositions({ orderFromButton: order(n), buttonSeat: 0, sbSeat: n === 2 ? 0 : 1, bbSeat: n === 2 ? 1 : 2 });
    return Array.from({ length: n }, (_, i) => m.get(i));
  };
  it.each([
    [2, ['BTN/SB', 'BB']],
    [3, ['BTN', 'SB', 'BB']],
    [4, ['BTN', 'SB', 'BB', 'UTG']],
    [5, ['BTN', 'SB', 'BB', 'UTG', 'CO']],
    [6, ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']],
    [7, ['BTN', 'SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO']],
    [8, ['BTN', 'SB', 'BB', 'UTG', 'MP', 'LJ', 'HJ', 'CO']],
    [9, ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO']],
    [10, ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO']],
  ])('%i players', (n, expected) => {
    expect(labels(n as number)).toEqual(expected);
  });

  it('dead button: nobody is labeled BTN', () => {
    const m = labelPositions({ orderFromButton: [7, 0, 2], buttonSeat: null, sbSeat: 7, bbSeat: 0 });
    expect([...m.entries()].sort()).toEqual([[0, 'BB'], [2, 'UTG'], [7, 'SB']]);
  });
});

describe('button and blind movement (dead-button rule)', () => {
  it('first hand: button where specified, then small and big blind', () => {
    const p = plan({ 0: 'active', 2: 'active', 5: 'active', 7: 'active' }, NEW_BUTTON_STATE, 2);
    expect([p.buttonSeat, p.sbSeat, p.bbSeat]).toEqual([2, 5, 7]);
    expect(p.dealtIn).toEqual([0, 2, 5, 7]);
  });

  it('moves one seat per hand', () => {
    const p = plan({ 0: 'active', 2: 'active', 5: 'active', 7: 'active' }, { lastBBSeat: 7, lastSBPos: 5 });
    expect([p.buttonSeat, p.sbSeat, p.bbSeat]).toEqual([5, 7, 0]);
  });

  it('big blind leaves: no small blind next hand, button moves to the old small blind', () => {
    const p = plan({ 0: 'active', 2: 'active', 5: 'active' }, { lastBBSeat: 7, lastSBPos: 5 });
    expect([p.buttonSeat, p.sbSeat, p.bbSeat]).toEqual([5, null, 0]);
    const hand = startHand(
      { handId: 'x', numSeats: 10, smallBlind: 1, bigBlind: 3, buttonSeat: 5, sbSeat: null, bbSeat: 0,
        players: p.dealtIn.map((seat) => ({ seat, id: `${seat}`, name: `${seat}`, stack: 100 })) },
      shuffledDeck(rng),
    );
    expect(hand.toAct).toBe(2);
    expect(hand.players.map((x) => [x.seat, x.position])).toEqual([[0, 'BB'], [2, 'UTG'], [5, 'BTN']]);
  });

  it('small blind leaves: the button is dead', () => {
    const p = plan({ 0: 'active', 2: 'active', 7: 'active' }, { lastBBSeat: 7, lastSBPos: 5 });
    expect([p.buttonSeat, p.sbSeat, p.bbSeat]).toEqual([5, 7, 0]);
    expect(p.dealtIn).not.toContain(5);
    const hand = startHand(
      { handId: 'x', numSeats: 10, smallBlind: 1, bigBlind: 3, buttonSeat: 5, sbSeat: 7, bbSeat: 0,
        players: p.dealtIn.map((seat) => ({ seat, id: `${seat}`, name: `${seat}`, stack: 100 })) },
      shuffledDeck(rng),
    );
    expect(hand.toAct).toBe(2);
  });

  it('a new player waiting for the big blind comes in when it reaches them', () => {
    const p = plan({ 2: 'active', 5: 'active', 7: 'active', 8: 'waitingForBB' }, { lastBBSeat: 7, lastSBPos: 5 });
    expect(p.bbSeat).toBe(8);
    expect(p.entering).toEqual([8]);
    expect(p.dealtIn).toEqual([2, 5, 7, 8]);
  });

  it('a waiting player elsewhere sits out until the big blind arrives', () => {
    const p1 = plan({ 2: 'active', 3: 'waitingForBB', 5: 'active', 7: 'active' }, { lastBBSeat: 7, lastSBPos: 5 });
    expect(p1.bbSeat).toBe(2);
    expect(p1.dealtIn).toEqual([2, 5, 7]);
    const p2 = plan({ 2: 'active', 3: 'waitingForBB', 5: 'active', 7: 'active' }, p1.next);
    expect(p2.bbSeat).toBe(3);
    expect(p2.entering).toEqual([3]);
  });

  it('a new player may post to come in, but not between the button and the big blind', () => {
    const outside = plan({ 0: 'active', 2: 'active', 3: 'postToEnter', 5: 'active', 7: 'active' }, { lastBBSeat: 7, lastSBPos: 5 });
    expect(outside.livePosters).toEqual([3]);
    expect(outside.dealtIn).toContain(3);
    const inside = plan({ 0: 'active', 2: 'active', 6: 'postToEnter', 5: 'active', 7: 'active' }, { lastBBSeat: 7, lastSBPos: 5 });
    expect(inside.livePosters).toEqual([]);
    expect(inside.dealtIn).not.toContain(6);
  });

  it('heads-up: the button posts the small blind and the blinds alternate', () => {
    const p1 = plan({ 1: 'active', 4: 'active' }, { lastBBSeat: 4, lastSBPos: 1 });
    expect([p1.buttonSeat, p1.sbSeat, p1.bbSeat]).toEqual([4, 4, 1]);
    const p2 = plan({ 1: 'active', 4: 'active' }, p1.next);
    expect([p2.buttonSeat, p2.sbSeat, p2.bbSeat]).toEqual([1, 1, 4]);
  });

  it('three players down to two', () => {
    const p = plan({ 0: 'active', 7: 'active' }, { lastBBSeat: 7, lastSBPos: 5 });
    expect([p.buttonSeat, p.sbSeat, p.bbSeat]).toEqual([7, 7, 0]);
  });

  it('two players up to three: the new player can post in when out of the blinds', () => {
    const p = plan({ 0: 'active', 2: 'postToEnter', 5: 'active' }, { lastBBSeat: 5, lastSBPos: 0 });
    expect(p.bbSeat).toBe(0);
    expect(p.sbSeat).toBe(5);
    expect(p.dealtIn).toEqual([0, 2, 5]);
    expect(p.livePosters).toEqual([2]);
    expect([0, 2, 5]).not.toContain(p.buttonSeat); // dead button
  });

  it('starts a fresh game when only one regular player remains', () => {
    const p = plan({ 3: 'active', 6: 'waitingForBB' }, { lastBBSeat: 1, lastSBPos: 0 });
    expect(p.dealtIn).toEqual([3, 6]);
    expect(p.sbSeat).toBe(p.buttonSeat);
  });

  it('returns null with fewer than two players', () => {
    expect(planNextHand(seats({ 3: 'active' }), 10, NEW_BUTTON_STATE, rng)).toBeNull();
  });
});
