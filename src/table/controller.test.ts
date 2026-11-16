import { describe, expect, it } from 'vitest';
import { legalActions } from '../engine/hand';
import { seededRng } from '../engine/rng';
import { TableController, type ControllerOptions, type Scheduler } from './controller';

/** A manual clock: timers fire only when the test advances time. */
class FakeScheduler implements Scheduler {
  private t = 0;
  private queue: Array<{ at: number; fn: () => void; id: number }> = [];
  private nextId = 1;
  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.queue.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimeout(h: unknown) {
    this.queue = this.queue.filter((x) => x.id !== h);
  }
  now() {
    return this.t;
  }
  pending() {
    return this.queue.length;
  }
  /** Runs the next timer. Returns false if none. */
  runNext(): boolean {
    this.queue.sort((a, b) => a.at - b.at);
    const next = this.queue.shift();
    if (!next) return false;
    this.t = next.at;
    next.fn();
    return true;
  }
}

function setup(extra: Partial<ControllerOptions> = {}) {
  const sched = new FakeScheduler();
  const ctl = new TableController({
    table: { id: 'T', name: 'Test', smallBlind: 1, bigBlind: 3, numSeats: 10 },
    heroSeat: 4,
    heroStack: 300,
    bots: [0, 1, 2, 3, 5, 6, 7, 8].map((seat) => ({ seat, id: `b${seat}`, name: `Bot ${seat}`, stack: 300 })),
    rebuyStack: 300,
    rng: seededRng(42),
    scheduler: sched,
    ...extra,
  });
  return { ctl, sched };
}

/** Lets bots act until it's the hero's turn or the hand is over. */
function runUntilHeroOrDone(ctl: TableController, sched: FakeScheduler) {
  for (let i = 0; i < 1000; i++) {
    const s = ctl.getSnapshot();
    if (s.stage !== 'in-hand' || s.hand?.toAct === s.heroSeat) return;
    if (!sched.runNext()) return;
  }
  throw new Error('hand did not progress');
}

describe('TableController', () => {
  it('plays 300 hands with the hero calling or checking, conserving chips', () => {
    const { ctl, sched } = setup({ settings: { autoDealMs: 1000, pauseAfterMyShowdown: false } });
    ctl.start();
    let rebought = 0;
    let lastHand = 0;
    while (ctl.getSnapshot().handNo < 300) {
      runUntilHeroOrDone(ctl, sched);
      const s = ctl.getSnapshot();
      if (s.stage === 'in-hand' && s.hand!.toAct === s.heroSeat) {
        const legal = legalActions(s.hand!)!;
        expect(ctl.heroAct(legal.canCheck ? { type: 'check' } : { type: 'call' })).toBeNull();
        continue;
      }
      expect(s.stage).toBe('hand-over');
      if (s.handNo !== lastHand) {
        lastHand = s.handNo;
        // After each hand: total chips = 9 starting stacks + all rebuys.
        const total = s.seats.reduce((a, o) => a + (o?.stack ?? 0), 0);
        rebought += s.notices.filter((n) => n.includes('rebought')).length;
        expect(total).toBe(9 * 300 + rebought * 300);
      }
      expect(s.autoDealAt).not.toBeNull();
      expect(sched.runNext()).toBe(true); // auto-deal fires
    }
  });

  it('waits for the hero, rejecting out-of-turn and illegal actions', () => {
    const { ctl, sched } = setup();
    ctl.start();
    runUntilHeroOrDone(ctl, sched);
    const s = ctl.getSnapshot();
    expect(s.hand!.toAct).toBe(4);
    expect(sched.pending()).toBe(0); // nothing scheduled while waiting for you
    expect(ctl.heroAct({ type: 'raise', to: 1 })).toMatch(/Minimum/);
    expect(ctl.heroAct({ type: 'fold' })).toBeNull();
    expect(ctl.heroAct({ type: 'fold' })).toBe('It is not your turn.');
  });

  it('fast-forwards the rest of the hand after a fold', () => {
    const { ctl, sched } = setup({ settings: { autoFastForward: true, aiSpeed: 'slow' } });
    ctl.start();
    runUntilHeroOrDone(ctl, sched);
    const before = sched.now();
    ctl.heroAct({ type: 'fold' });
    expect(ctl.getSnapshot().fastForward).toBe(true);
    runUntilHeroOrDone(ctl, sched);
    const s = ctl.getSnapshot();
    expect(s.stage).toBe('hand-over');
    const actionsAfter = s.hand!.events.filter((e) => e.type === 'bet').length;
    expect(sched.now() - before).toBeLessThanOrEqual(actionsAfter * 25);
  });

  it('pauses before dealing after a showdown you played, unless you turn that off', () => {
    const { ctl, sched } = setup({ settings: { pauseAfterMyShowdown: true } });
    ctl.start();
    // Hero checks/calls every hand until one reaches showdown with the hero in it.
    for (let guard = 0; guard < 200; guard++) {
      runUntilHeroOrDone(ctl, sched);
      const s = ctl.getSnapshot();
      if (s.stage === 'in-hand') {
        const legal = legalActions(s.hand!)!;
        ctl.heroAct(legal.canCheck ? { type: 'check' } : { type: 'call' });
        continue;
      }
      const hero = s.hand!.players.find((p) => p.seat === 4);
      if (hero && !hero.folded && s.hand!.result!.wentToShowdown) {
        expect(s.autoDealAt).toBeNull();
        expect(sched.pending()).toBe(0);
        ctl.dealNow();
        expect(ctl.getSnapshot().stage).toBe('in-hand');
        return;
      }
      sched.runNext();
    }
    throw new Error('no showdown reached');
  });

  it('pause stops the bots; resume continues', () => {
    const { ctl, sched } = setup();
    ctl.start();
    ctl.setPaused(true);
    if (ctl.getSnapshot().hand!.toAct !== 4) expect(sched.pending()).toBe(0);
    ctl.setPaused(false);
    runUntilHeroOrDone(ctl, sched);
    expect(ctl.getSnapshot().stage === 'hand-over' || ctl.getSnapshot().hand!.toAct === 4).toBe(true);
  });

  it('posts your straddle when you are under the gun', () => {
    const { ctl, sched } = setup({ settings: { straddle: true, autoDealMs: 10, pauseAfterMyShowdown: false } });
    ctl.start();
    for (let i = 0; i < 40; i++) {
      const s = ctl.getSnapshot();
      const hand = s.hand!;
      const straddle = hand.events.find((e) => e.type === 'bet' && e.postKind === 'straddle');
      if (straddle) {
        expect(straddle.type === 'bet' && straddle.seat).toBe(4);
        expect(hand.currentBet).toBeGreaterThanOrEqual(6);
        return;
      }
      runUntilHeroOrDone(ctl, sched);
      if (ctl.getSnapshot().stage === 'in-hand') ctl.heroAct({ type: 'fold' });
      runUntilHeroOrDone(ctl, sched);
      sched.runNext();
    }
    throw new Error('hero never straddled');
  });

  it('tops you up between hands', () => {
    const { ctl, sched } = setup({ heroStack: 100 });
    ctl.start();
    runUntilHeroOrDone(ctl, sched);
    ctl.heroAct({ type: 'fold' });
    runUntilHeroOrDone(ctl, sched);
    ctl.topUpHero(300);
    expect(ctl.getSnapshot().seats[4]!.stack).toBe(300);
  });

  it('suspend stops timers and start resumes where it left off', () => {
    const { ctl, sched } = setup();
    ctl.start();
    const hand = ctl.getSnapshot().hand;
    ctl.suspend();
    expect(sched.pending()).toBe(0);
    ctl.start(); // must not deal a new hand
    expect(ctl.getSnapshot().hand).toBe(hand);
    runUntilHeroOrDone(ctl, sched);
    const s = ctl.getSnapshot();
    expect(s.stage === 'hand-over' || s.hand!.toAct === 4).toBe(true);
  });
});
