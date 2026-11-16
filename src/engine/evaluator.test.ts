import { describe, expect, it } from 'vitest';
import { parseCards, cardsToString } from './cards';
import { orderedDeck } from './deck';
import { bestFiveCards, Category, categoryOf, describeHand, evaluate, straightHigh } from './evaluator';
import { referenceEvaluate } from './referenceEvaluator';
import { seededRng, shuffle } from './rng';

const ev = (s: string) => evaluate(parseCards(s));
const desc = (s: string) => describeHand(ev(s));
/** Compare two players' hole cards on the same board: >0 if a wins, <0 if b wins, 0 tie. */
const versus = (a: string, b: string, board: string) =>
  Math.sign(ev(`${a} ${board}`) - ev(`${b} ${board}`));

describe('hand categories', () => {
  it.each([
    ['As Ks Qs Js Ts 2c 3d', Category.StraightFlush],
    ['9h 9d 9s 9c Kd 2c 3d', Category.Quads],
    ['9h 9d 9s Kc Kd 2c 3d', Category.FullHouse],
    ['2h 7h 9h Jh Kh Ac Ad', Category.Flush],
    ['5c 6d 7h 8s 9c Ac Ad', Category.Straight],
    ['7c 7d 7h Ks 2c 3d 9h', Category.Trips],
    ['7c 7d Kh Ks 2c 3d 9h', Category.TwoPair],
    ['7c 7d Kh Qs 2c 3d 9h', Category.Pair],
    ['7c 8d Kh Qs 2c 3d 9h', Category.HighCard],
  ])('%s', (cards, cat) => {
    expect(categoryOf(ev(cards))).toBe(cat);
  });
});

describe('the wheel (A-2-3-4-5)', () => {
  it('counts as a Five-high straight', () => {
    expect(desc('Ah 2c 3d 4s 5h Kd Qc')).toBe('a straight, Ace to Five');
    expect(straightHigh(0b1_0000_0000_1111)).toBe(3);
  });
  it('loses to a six-high straight', () => {
    expect(versus('6c Kd', 'Ah Kc', '2c 3d 4s 5h 9d')).toBe(1);
  });
  it('steel wheel is a straight flush, Five high', () => {
    expect(categoryOf(ev('Ah 2h 3h 4h 5h Kd Qc'))).toBe(Category.StraightFlush);
    expect(desc('Ah 2h 3h 4h 5h Kd Qc')).toBe('a straight flush, Ace to Five');
  });
  it('does not wrap around (Q-K-A-2-3 is not a straight)', () => {
    expect(categoryOf(ev('Qh Kd Ac 2s 3h 8c 9d'))).toBe(Category.HighCard);
  });
  it('a 6-card straight uses the highest five', () => {
    expect(desc('Ah 2c 3d 4s 5h 6d Kc')).toBe('a straight, Deuce to Six');
  });
});

describe('the board plays', () => {
  it('straight on board splits the pot', () => {
    expect(versus('2c 2d', '3c 3d', 'As Kd Qh Jc Th')).toBe(0);
  });
  it('royal flush on board splits the pot', () => {
    expect(versus('2c 2d', 'Ac Ad', 'As Ks Qs Js Ts')).toBe(0);
    expect(desc('2c 2d As Ks Qs Js Ts')).toBe('a Royal Flush');
  });
  it('full house on board ties when nobody improves', () => {
    expect(versus('2c 3d', '4c 5d', 'Kh Kd Ks 9c 9d')).toBe(0);
  });
  it('a higher card does not play when the board is better', () => {
    // Board two pair Q-Q-J-J with an Ace: both players play A-Q-Q-J-J.
    expect(versus('Kc 7d', '8c 5d', 'Qs Qd Js Jh Ac')).toBe(0);
  });
});

describe('kickers', () => {
  it('kicker decides one pair', () => {
    expect(versus('As Kd', 'Ac Qd', 'Ah 9c 7d 4s 2h')).toBe(1);
  });
  it('kicker does not play beyond five cards', () => {
    // Both have A-A with K-Q-J on board: fifth card is the board's J for both.
    expect(versus('Ac 3d', 'Ad 2c', 'As Kh Qd Jc 9s')).toBe(0);
  });
  it('second kicker decides', () => {
    expect(versus('Ac Kd', 'Ad Kc', '9s 9h 5d 4c 2s')).toBe(0);
    expect(versus('Ac Kd', 'Ad Qc', '9s 9h 5d 4c 2s')).toBe(1);
  });
  it('quads on board: best kicker wins', () => {
    expect(versus('Ac 2d', 'Qc Qd', '7s 7h 7d 7c Kh')).toBe(1);
    expect(versus('3c 2d', '4c 4d', '7s 7h 7d 7c Kh')).toBe(0);
  });
  it('flush compares all five cards', () => {
    expect(versus('Ah 3c', 'Kh 4c', '2h 7h 9h Jh 5c')).toBe(1);
    expect(versus('3h 2c', '4h 2d', 'Ah Kh 9h Jh 5c')).toBe(-1);
  });
});

describe('two pair', () => {
  it('is counterfeited by a paired board (8-7 loses to A-8 on 8-7-3-K-K)', () => {
    // Hero's sevens no longer play: K-K-8-8-7 vs K-K-8-8-A.
    expect(desc('8c 7d 8s 7h 3c Kh Kd')).toBe('two pair, Kings and Eights');
    expect(versus('8c 7d', 'Ad 8d', '8s 7h 3c Kh Kd')).toBe(-1);
  });
  it('three pairs: best two pairs plus the best remaining card', () => {
    expect(desc('Ac 5d As 5s Kh Kd 2c')).toBe('two pair, Aces and Kings');
    // Both players' fifth card is the board's 5.
    expect(versus('Ac 5d', 'Ad 3c', 'As 5s Kh Kd 2c')).toBe(0);
  });
  it('the third pair can be the kicker that decides', () => {
    expect(versus('Qc Qd', 'Jc 2d', 'Ah Ad Kh Kd 3c')).toBe(1);
  });
});

describe('full houses and flushes', () => {
  it('two sets make a full house with the higher set on top', () => {
    expect(desc('8c 8d 8s 4h 4d 4c Kh')).toBe('a full house, Eights full of Fours');
  });
  it('trips plus two pairs uses the higher pair', () => {
    expect(desc('5c 5d 5s Kh Kd 9c 9d')).toBe('a full house, Fives full of Kings');
  });
  it('flush beats straight when both are present', () => {
    expect(categoryOf(ev('6h 7h 8c 9h Th 2h Ac'))).toBe(Category.Flush);
  });
  it('six suited cards: the best five count', () => {
    expect(versus('Ah 2c', '3h 2d', 'Kh 9h 7h 5h 4h')).toBe(1);
  });
  it('straight flush beats quads', () => {
    expect(versus('8h 9h', 'Tc Td', '5h 6h 7h Ts Th')).toBe(1);
  });
});

describe('descriptions (PokerStars wording)', () => {
  it.each([
    ['As Ad 7c 4d 2h 9s 3c', 'a pair of Aces'],
    ['As Kd 7c 4d 2h 9s 3c', 'high card Ace'],
    ['7s 7d 7c 4d 2h 9s Kc', 'three of a kind, Sevens'],
    ['Ts Jd Qc Kd Ah 2s 3c', 'a straight, Ten to Ace'],
    ['2s 7s Ts Js Ks Ah Ad', 'a flush, King high'],
    ['Js Jd Jc Jh Ah 2s 3c', 'four of a kind, Jacks'],
    ['9s Ts Js Qs Ks 2h 3c', 'a straight flush, Nine to King'],
  ])('%s → %s', (cards, text) => {
    expect(desc(cards)).toBe(text);
  });
});

describe('bestFiveCards', () => {
  it('finds the five cards that make the hand', () => {
    const seven = parseCards('8c 7d 8s 7h 3c Kh Kd');
    const five = bestFiveCards(seven);
    expect(five).toHaveLength(5);
    expect(evaluate(five)).toBe(evaluate(seven));
    expect(cardsToString(five)).not.toContain('3c');
  });
});

describe('cross-check against the brute-force evaluator', () => {
  it('agrees on 30,000 random 5, 6 and 7 card hands', () => {
    const rng = seededRng(12345);
    for (let i = 0; i < 30_000; i++) {
      const n = 5 + (i % 3);
      const cards = shuffle(orderedDeck(), rng).slice(0, n);
      const fast = evaluate(cards);
      const slow = referenceEvaluate(cards);
      if (fast !== slow) throw new Error(`Mismatch on ${cardsToString(cards)}: ${fast} vs ${slow}`);
    }
  });
});
