import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { legalActions } from '../engine/hand';
import { seededRng } from '../engine/rng';
import { PokerDb } from '../storage/db';
import type { TableController } from '../table/controller';
import { FakeScheduler } from '../table/fakeScheduler';
import { STAKES } from '../table/stakes';
import { GameStore, START_BANKROLL } from './gameStore';

let dbCount = 0;
function setup(seed = 1, db = new PokerDb(`test-${Date.now()}-${dbCount++}`)) {
  const sched = new FakeScheduler();
  const store = new GameStore({
    db,
    rng: seededRng(seed),
    scheduler: sched,
    tableSettings: () => ({ aiSpeed: 'instant', autoDealMs: 10, pauseAfterMyShowdown: false, aiStraddles: true }),
    saveDelayMs: 1,
  });
  return { store, sched, db };
}

/** Runs the table until it's your turn, a hand ends, or you're waiting for chips. */
function runBots(ctl: TableController, sched: FakeScheduler, limit = 2000) {
  const startHand = ctl.getSnapshot().handNo;
  const startStage = ctl.getSnapshot().stage;
  for (let i = 0; i < limit; i++) {
    const s = ctl.getSnapshot();
    if (s.closed || s.heroBusted) return;
    if (s.stage === 'in-hand' && s.hand?.toAct === s.heroSeat) return;
    if (s.stage === 'hand-over' && s.hand && (s.handNo !== startHand || startStage === 'in-hand')) return;
    if (!sched.runNext()) return;
  }
}

async function sitAtLowStakes(store: GameStore, amount = 300, entry: 'post' | 'wait' = 'post') {
  const preview = store.previewTable(STAKES[0]);
  const seat = preview.seats.findIndex((o) => !o);
  const err = await store.sitDown(preview, seat, amount, entry);
  expect(err).toBeNull();
  return store.getSnapshot().table!;
}

const total = (store: GameStore) => store.getSnapshot().profile.bankroll + (store.getSnapshot().table?.ctl.heroStack() ?? 0);

describe('bankroll', () => {
  it('starts at $2,000; tables you cannot afford are locked', async () => {
    const { store, db } = setup();
    await store.load();
    expect(store.getSnapshot().profile.bankroll).toBe(START_BANKROLL);
    expect(await db.bankroll.count()).toBe(1);
    expect(STAKES.map((s) => store.canAfford(s))).toEqual([true, true, true, true, false]);
    expect(store.buyInRange(STAKES[3])).toEqual({ min: 800, max: 2000 }); // no max: up to your bankroll
  });

  it('the buy-in comes out of the bankroll and must be within the table limits', async () => {
    const { store } = setup();
    await store.load();
    const preview = store.previewTable(STAKES[0]);
    const seat = preview.seats.findIndex((o) => !o);
    expect(await store.sitDown(preview, seat, 99, 'post')).toMatch(/between \$100 and \$500/);
    expect(await store.sitDown(preview, seat, 501, 'post')).toMatch(/between/);
    expect(await store.sitDown(preview, preview.seats.findIndex((o) => !!o), 300, 'post')).toMatch(/taken/);
    expect(await store.sitDown(preview, seat, 300, 'post')).toBeNull();
    expect(store.getSnapshot().profile.bankroll).toBe(1700);
    expect(store.getSnapshot().table!.ctl.heroStack()).toBe(300);
  });

  it('every hand’s result shows up in bankroll + stack; leaving returns the stack', async () => {
    const { store, sched, db } = setup(7);
    await store.load();
    const t = await sitAtLowStakes(store);
    const ctl = t.ctl;
    // Count every finished hand you were dealt into, and check the money each time.
    let expected = total(store);
    let handsWithHero = 0;
    let lastCounted = 0;
    ctl.subscribe(() => {
      const s = ctl.getSnapshot();
      if (s.stage !== 'hand-over' || !s.hand || s.handNo === lastCounted) return;
      lastCounted = s.handNo;
      const net = s.hand.result!.net[s.heroSeat];
      if (net === undefined) return;
      handsWithHero++;
      expected += net;
      expect(total(store)).toBe(expected);
    });
    ctl.start();
    for (let i = 0; i < 2000 && handsWithHero < 60; i++) {
      runBots(ctl, sched);
      const s = ctl.getSnapshot();
      if (s.heroBusted) {
        expect(await store.addChips(300)).toBeNull();
        expected = total(store);
        continue;
      }
      if (s.stage === 'in-hand' && s.hand!.toAct === s.heroSeat) {
        const legal = legalActions(s.hand!)!;
        ctl.heroAct(legal.canCheck ? { type: 'check' } : legal.callAmount <= 30 ? { type: 'call' } : { type: 'fold' });
        continue;
      }
      if (!sched.runNext()) break;
    }
    expect(handsWithHero).toBeGreaterThan(20);
    expect(store.getSnapshot().table!.hands).toBe(handsWithHero);

    // Leave between hands: the stack goes back to the bankroll.
    runBots(ctl, sched);
    const before = total(store);
    store.leave();
    await new Promise((r) => setTimeout(r, 20));
    const snap = store.getSnapshot();
    if (snap.table) {
      // You were in a hand: you leave when it ends.
      expect(snap.table.ctl.getSnapshot().leaveAfterHand).toBe(true);
      const legal = legalActions(ctl.getSnapshot().hand!)!;
      ctl.heroAct(legal.canCheck ? { type: 'check' } : { type: 'fold' });
      runBots(ctl, sched);
      while (store.getSnapshot().table) {
        const s = ctl.getSnapshot();
        if (s.stage === 'in-hand' && s.hand!.toAct === s.heroSeat) {
          const l = legalActions(s.hand!)!;
          ctl.heroAct(l.canCheck ? { type: 'check' } : { type: 'fold' });
        } else if (!sched.runNext()) break;
        await new Promise((r) => setTimeout(r, 1));
      }
      await new Promise((r) => setTimeout(r, 20));
    } else {
      expect(snap.profile.bankroll).toBe(before);
    }
    expect(store.getSnapshot().table).toBeNull();
    expect(store.getSnapshot().lastSession).not.toBeNull();
    const sessions = await db.sessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].cashedOut).toBe(store.getSnapshot().lastSession!.cashedOut);
    expect(await db.kv.get('activeTable')).toBeUndefined();
  });

  it('top-ups are limited by the table max and your bankroll', async () => {
    const { store } = setup();
    await store.load();
    await sitAtLowStakes(store, 300);
    expect(store.addChipsRange()).toEqual({ min: 1, max: 200 });
    expect(await store.addChips(201)).toMatch(/between \$1 and \$200/);
    expect(await store.addChips(200)).toBeNull();
    expect(store.getSnapshot().profile.bankroll).toBe(1500);
    expect(store.addChipsRange()).toBeNull(); // already at the max
  });

  it('busting stops the game until you rebuy (at least the minimum) or leave', async () => {
    const { store, sched } = setup(3);
    await store.load();
    const t = await sitAtLowStakes(store, 100);
    const ctl = t.ctl;
    ctl.start();
    // Shove every hand until busted.
    for (let i = 0; i < 3000 && !ctl.getSnapshot().heroBusted; i++) {
      runBots(ctl, sched);
      const s = ctl.getSnapshot();
      if (s.heroBusted) break;
      if (s.stage === 'in-hand' && s.hand!.toAct === s.heroSeat) ctl.heroAct({ type: 'allin' });
      else sched.runNext();
    }
    expect(ctl.getSnapshot().heroBusted).toBe(true);
    expect(sched.pending()).toBe(0); // nothing dealt while you're out of chips
    expect(store.addChipsRange()).toEqual({ min: 100, max: 500 });
    expect(await store.addChips(50)).toMatch(/between \$100/);
    expect(await store.addChips(100)).toBeNull();
    expect(ctl.getSnapshot().heroBusted).toBe(false);
    expect(sched.pending()).toBe(1); // dealing resumes
  });

  it('offers a fresh $2,000 only when you can’t afford any table and have no chips in play', async () => {
    const { store, db } = setup();
    await store.load();
    expect(store.canReset()).toBe(false);
    await db.kv.put({ key: 'profile', value: { bankroll: 40, createdAt: 0, resets: 0 } });
    const { store: s2 } = setup(1, db);
    await s2.load();
    expect(s2.canReset()).toBe(true);
    await s2.resetBankroll();
    expect(s2.getSnapshot().profile).toMatchObject({ bankroll: 2000, resets: 1 });
    expect(s2.canReset()).toBe(false);
  });

  it('rake, when turned on, applies from the next hand', async () => {
    const { store } = setup();
    await store.load();
    const t = await sitAtLowStakes(store);
    await store.setRake({ ...store.getSnapshot().rake, enabled: true });
    expect(t.ctl.getSnapshot().table.rake).toEqual({ enabled: true, percent: 10, cap: 5, noFlopNoDrop: true });
  });
});

describe('saving and resuming', () => {
  it('a refresh mid-hand brings back the exact same hand', async () => {
    const db = new PokerDb(`resume-${Date.now()}`);
    const first = setup(11, db);
    await first.store.load();
    const t = await sitAtLowStakes(first.store, 300, 'post');
    t.ctl.start();
    // Play until you have a decision in a hand.
    for (let i = 0; i < 200; i++) {
      runBots(t.ctl, first.sched);
      const s = t.ctl.getSnapshot();
      if (s.stage === 'in-hand' && s.hand!.toAct === s.heroSeat) break;
      first.sched.runNext();
    }
    const before = t.ctl.getSnapshot();
    expect(before.hand!.toAct).toBe(before.heroSeat);
    await first.store.saveNow();

    // "Refresh": a brand-new store reading the same database.
    const second = setup(99, db);
    await second.store.load();
    const restored = second.store.getSnapshot().table!;
    expect(restored).not.toBeNull();
    const after = restored.ctl.getSnapshot();
    expect(after.handNo).toBe(before.handNo);
    expect(after.hand!.deck).toEqual(before.hand!.deck);
    expect(after.hand!.events).toEqual(before.hand!.events);
    expect(after.hand!.toAct).toBe(before.heroSeat);
    expect(second.store.getSnapshot().profile.bankroll).toBe(first.store.getSnapshot().profile.bankroll);
    expect(restored.director.stats.counts.size).toBe(t.director.stats.counts.size);

    // The rest of the hand plays out the same way: the cards still to come are the same.
    restored.ctl.start();
    const legal = legalActions(after.hand!)!;
    restored.ctl.heroAct(legal.canCheck ? { type: 'check' } : { type: 'call' });
    for (let i = 0; i < 500 && restored.ctl.getSnapshot().stage === 'in-hand'; i++) {
      const s = restored.ctl.getSnapshot();
      if (s.hand!.toAct === s.heroSeat) {
        const l = legalActions(s.hand!)!;
        restored.ctl.heroAct(l.canCheck ? { type: 'check' } : { type: 'call' });
      } else second.sched.runNext();
    }
    const done = restored.ctl.getSnapshot().hand!;
    expect(done.phase).toBe('complete');
    const remaining = before.hand!.deck.slice(before.hand!.deckPos);
    // Every board card dealt after the save came off the saved deck, in order.
    const newBoard = done.board.slice(before.hand!.board.length);
    for (const c of newBoard) expect(remaining).toContain(c);
  });
});
