import { describe, expect, it } from 'vitest';
import { orderedDeck, shuffledDeck } from './deck';
import { secureRng, seededRng, shuffle } from './rng';
import { runSimulation } from './simulate';
import { act, makeHand } from './testUtils';
import { getPlayerView } from './view';
import { basicBotDecide } from '../ai/basicBot';
import { applyAction } from './hand';

describe('secure shuffle', () => {
  it('produces a permutation without changing the input', () => {
    const deck = orderedDeck();
    const shuffled = shuffle(deck);
    expect(deck).toEqual(orderedDeck());
    expect([...shuffled].sort((a, b) => a - b)).toEqual(deck);
  });

  it('secureRng.int stays in range and is roughly uniform', () => {
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 60_000; i++) counts[secureRng.int(6)]++;
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(600);
  });

  it('every card is about equally likely to land on top', () => {
    const top = new Array(52).fill(0);
    for (let i = 0; i < 52_000; i++) top[shuffledDeck()[0]]++;
    for (const c of top) expect(Math.abs(c - 1000)).toBeLessThan(160);
  });

  it('seeded generator is reproducible', () => {
    expect(shuffle(orderedDeck(), seededRng(7))).toEqual(shuffle(orderedDeck(), seededRng(7)));
  });
});

describe('player view (no peeking)', () => {
  it('contains only the viewer’s own hole cards and no deck', () => {
    const s = makeHand({ stacks: { 0: 300, 1: 300, 2: 300 }, button: 0, sb: 1, bb: 2, holes: { 0: 'Ac Ad', 1: 'Kc Kd', 2: 'Qc Qd' } });
    const view = getPlayerView(s, 0) as unknown as Record<string, unknown>;
    expect(view.hole).toEqual(s.players[0].hole);
    expect(view).not.toHaveProperty('deck');
    for (const p of view.players as Record<string, unknown>[]) {
      expect(p).not.toHaveProperty('hole');
      expect(p.shownCards).toBeNull();
    }
    expect(JSON.stringify(view)).not.toContain('deckPos');
    expect(view.legal).not.toBeNull(); // button acts first 3-handed
    expect(getPlayerView(s, 1).legal).toBeNull();
  });

  it('shows cards only after they are tabled at showdown', () => {
    let s = makeHand({ stacks: { 0: 300, 1: 300 }, button: 0, sb: 0, bb: 1, holes: { 0: 'Ac Ad', 1: 'Kc Kd' }, board: '2s 7h 9c 4d Js' });
    s = act(s, 'a', 'c');
    const view = getPlayerView(s, 1);
    expect(view.players.find((p) => p.seat === 0)!.shownCards).toEqual(s.players[0].hole);
  });
});

describe('basic bot', () => {
  it('always makes legal decisions over many hands', () => {
    const rng = seededRng(99);
    for (let h = 0; h < 300; h++) {
      let s = makeHand({ stacks: { 0: 300, 1: 150, 2: 600, 3: 40, 4: 300, 5: 1000 }, button: h % 6, sb: (h + 1) % 6, bb: (h + 2) % 6 });
      while (s.phase !== 'complete') {
        const seat = s.toAct!;
        s = applyAction(s, seat, basicBotDecide(getPlayerView(s, seat), rng));
      }
    }
  });
});

describe('rules simulation', () => {
  it('plays 4,000 chaotic hands with no rule violations', () => {
    const report = runSimulation(4000, 2024);
    expect(report.errors).toEqual([]);
    expect(report.hands).toBe(4000);
    // Make sure the tricky situations actually came up.
    expect(report.sidePotHands).toBeGreaterThan(50);
    expect(report.splitPots).toBeGreaterThan(5);
    expect(report.straddles).toBeGreaterThan(50);
    expect(report.livePosts).toBeGreaterThan(10);
    expect(report.deadButtons).toBeGreaterThan(5);
    expect(report.deadSmallBlinds).toBeGreaterThan(5);
    expect(report.headsUpHands).toBeGreaterThan(5);
    expect(report.rakedHands).toBeGreaterThan(50);
    expect(report.allInRunouts).toBeGreaterThan(50);
    expect(report.illegalAttemptsRejected).toBeGreaterThan(500);
  });
});
