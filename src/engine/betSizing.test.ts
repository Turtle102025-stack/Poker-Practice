import { describe, expect, it } from 'vitest';
import { legalizeAmount, potFractionTo, roundToUnit } from './betSizing';
import { legalActions, potTotal } from './hand';
import { act, makeHand } from './testUtils';

const six = { 0: 300, 1: 300, 2: 300, 3: 300, 4: 300, 5: 300 };

describe('pot-fraction sizes', () => {
  it('pot-sized open raise preflop at $1/$3 is to $10', () => {
    const s = makeHand({ stacks: six, button: 0, sb: 1, bb: 2 });
    const legal = legalActions(s)!;
    expect(potFractionTo(legal, potTotal(s), s.currentBet, 1)).toBe(10);
  });

  it('pot-sized raise facing a bet: call, then raise the pot after calling', () => {
    // Flop pot 18, SB bets 12: pot is 30, BB faces 12. Pot raise = 12 + (30 + 12) = 54.
    let s = makeHand({ stacks: six, button: 0, sb: 1, bb: 2 });
    s = act(s, 'c', 'c', 'c', 'c', 'c', 'x', 'b12');
    const legal = legalActions(s)!;
    expect(potFractionTo(legal, potTotal(s), s.currentBet, 1)).toBe(54);
  });

  it('bets are a fraction of the pot', () => {
    let s = makeHand({ stacks: six, button: 0, sb: 1, bb: 2 });
    s = act(s, 'c', 'c', 'c', 'c', 'c', 'x');
    const legal = legalActions(s)!;
    expect(potFractionTo(legal, potTotal(s), s.currentBet, 2 / 3)).toBe(12);
  });

  it('rounds to the chip unit', () => {
    expect(roundToUnit(17.4, 5)).toBe(15);
    expect(roundToUnit(17.6, 5)).toBe(20);
    expect(roundToUnit(0.4, 1)).toBe(1);
  });
});

describe('legalizing typed amounts', () => {
  let s = makeHand({ stacks: six, button: 0, sb: 1, bb: 2 });
  s = act(s, 'r35'); // raise of 32: minimum re-raise is to 67
  const legal = legalActions(s)!;

  it('raises a too-small amount to the minimum and says why', () => {
    expect(legalizeAmount(legal, 50)).toEqual({ to: 67, note: 'Minimum raise is to $67.', allIn: false });
  });
  it('caps an amount above the stack at all-in', () => {
    expect(legalizeAmount(legal, 500)).toEqual({ to: 300, note: "That's more than you have. All-in is $300.", allIn: true });
  });
  it('accepts a legal amount without a note', () => {
    expect(legalizeAmount(legal, 120)).toEqual({ to: 120, note: null, allIn: false });
  });
  it('explains quick-button adjustments', () => {
    expect(legalizeAmount(legal, 40, '⅓ pot').note).toBe('⅓ pot would be $40. Minimum raise is to $67.');
  });
  it('handles empty input', () => {
    expect(legalizeAmount(legal, NaN).to).toBe(67);
  });
  it('says when all-in is the only raise possible', () => {
    let t = makeHand({ stacks: { 0: 300, 1: 300, 2: 300, 3: 12 }, button: 0, sb: 1, bb: 2 });
    t = act(t, 'c', 'r10', 'f', 'f');
    const l = legalActions(t)!;
    expect(legalizeAmount(l, 11).to).toBe(12);
    expect(legalizeAmount(l, 11).note).toContain('only option is all-in for $12');
  });
  it('uses "bet" wording when nobody has bet yet', () => {
    let t = makeHand({ stacks: six, button: 0, sb: 1, bb: 2 });
    t = act(t, 'c', 'c', 'c', 'c', 'c', 'x');
    expect(legalizeAmount(legalActions(t)!, 1).note).toBe('Minimum bet is $3.');
  });
});
