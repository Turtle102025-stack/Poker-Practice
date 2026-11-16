import { describe, expect, it } from 'vitest';
import { parseCards } from '../engine/cards';
import { boardTexture, isScareCard, readHand } from './handRead';
import { handCode, handPercentile } from './handRank';

const read = (hole: string, board: string) => readHand(parseCards(hole), parseCards(board));

describe('starting hand ranks', () => {
  it('ranks AA first and 32o last', () => {
    expect(handPercentile(parseCards('As Ad'))).toBeCloseTo(6 / 1326, 5);
    expect(handPercentile(parseCards('3c 2d'))).toBe(1);
  });
  it('orders sensible hands', () => {
    const p = (h: string) => handPercentile(parseCards(h));
    expect(p('Ks Kd')).toBeLessThan(p('As Kd'));
    expect(p('As Ks')).toBeLessThan(p('As Kd'));
    expect(p('As Kd')).toBeLessThan(p('7s 7d'));
    expect(p('Js Ts')).toBeLessThan(p('Jd 8c'));
    expect(p('Ac Qd')).toBeLessThan(0.07);
    expect(p('7c 2d')).toBeGreaterThan(0.97);
  });
  it('names hands', () => {
    expect(handCode(parseCards('Kd As'))).toBe('AKo');
    expect(handCode(parseCards('9h Th'))).toBe('T9s');
    expect(handCode(parseCards('4c 4d'))).toBe('44');
  });
});

describe('postflop hand reading', () => {
  it('ranks made hands in a sensible order on a dry board', () => {
    const board = 'Kh 7c 2d';
    const set = read('7s 7d', board).strength;
    const topTop = read('Ks Ad', board).strength;
    const topWeak = read('Ks 4d', board).strength;
    const over = read('Qs Qd', board).strength;
    const second = read('7s 8d', board).strength;
    const air = read('Js Td', board).strength;
    expect(set).toBeGreaterThan(topTop);
    expect(topTop).toBeGreaterThan(topWeak);
    expect(over).toBeLessThan(topTop + 0.2);
    expect(topWeak).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(air);
    expect(read('Ks Ad', board).pairKind).toBe('top');
    expect(read('As Ad', board).pairKind).toBe('overpair');
  });

  it('a pair on the board is not our pair', () => {
    const r = read('Js Td', 'Kh Kc 2d');
    expect(r.pairKind).toBe('board');
    expect(r.strength).toBeLessThan(0.2);
  });

  it('flushes: the nut flush is stronger than a low flush, and a paired board hurts', () => {
    const nut = read('Ah 3c', 'Kh 9h 5h 2c').strength;
    const low = read('6h 3c', 'Kh 9h 5h 2c').strength;
    expect(nut).toBeGreaterThan(low);
    expect(read('Ah 3c', 'Kh 9h 5h 9c').strength).toBeLessThan(nut);
  });

  it('a straight is weaker when three of a suit are on board', () => {
    expect(read('9s 8s', '7h 6d 5c').strength).toBeGreaterThan(read('9s 8s', '7h 6h 5h').strength);
  });

  it('finds draws and outs', () => {
    const fd = read('Ah Kh', 'Qh 7h 2c');
    expect(fd.hasFlushDraw).toBe(true);
    expect(fd.outs).toBeGreaterThanOrEqual(9);
    expect(fd.drawEquity).toBeGreaterThan(0.33);
    const oesd = read('9c 8d', 'Kh 7s 6c');
    expect(oesd.hasStraightDraw).toBe(true);
    expect(oesd.outs).toBe(8);
    const gut = read('9c 8d', 'Kh 7s 5c');
    expect(gut.outs).toBe(4);
    // Two overcards add a few outs.
    expect(read('9c 8d', '7h 6s 2c').outs).toBe(11);
    expect(read('9c 8d', '7h 6s 2c 3d 4s').drawEquity).toBe(0);
  });

  it('notices scare cards', () => {
    expect(isScareCard(parseCards('Kc Kd'), parseCards('9h 7h 2c 4h'))).toBe(true); // third heart
    expect(isScareCard(parseCards('Kc Kd'), parseCards('9h 7s 2c Ah'))).toBe(true); // overcard
    expect(isScareCard(parseCards('Kc Kd'), parseCards('9h 7s 2c 3d'))).toBe(false);
  });

  it('board texture', () => {
    expect(boardTexture(parseCards('Kh 7c 2d')).wetness).toBeLessThan(0.2);
    expect(boardTexture(parseCards('Jh Th 9c')).wetness).toBeGreaterThan(0.6);
  });
});
