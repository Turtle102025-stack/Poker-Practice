import { AiDirector, type DirectorState } from '../ai/director';
import { secureRng, type Rng } from '../engine/rng';
import type { ButtonState } from '../engine/table';
import type { HandState, RakeConfig } from '../engine/types';
import { makeRecord, type HandRecord } from '../history/record';
import { emptyCounts, recordHand, type StatCounts } from '../ai/publicStats';
import { getDb, requestPersistentStorage, type BankrollPoint, type PlayerNote, type PokerDb, type ReadLabel } from '../storage/db';
import { TableController, type ControllerState, type Occupant, type Scheduler, type TableSettings } from '../table/controller';
import { Seating } from '../table/seating';
import { stakeById, STAKES, type Stake } from '../table/stakes';

/**
 * Your money and where it is: the bankroll (off the table) and the chips in
 * front of you at the table you're sitting at. Everything is saved in the
 * browser after every change, including the hand in progress.
 */

export const START_BANKROLL = 2000;
const SMALLEST_BUY_IN = Math.min(...STAKES.map((s) => s.minBuyIn));

export interface Profile {
  bankroll: number;
  createdAt: number;
  resets: number;
}

export interface RakeSettings {
  enabled: boolean;
  /** Percent of each pot. */
  percent: number;
  noFlopNoDrop: boolean;
  /** Maximum rake per hand at each stake. */
  caps: Record<string, number>;
}

export const DEFAULT_RAKE: RakeSettings = {
  enabled: false,
  percent: 10,
  noFlopNoDrop: true,
  caps: { '1-3': 5, '2-5': 6, '5-10': 8, '10-20': 10, '50-100': 20 },
};

export function rakeConfigFor(rake: RakeSettings, stake: Stake): RakeConfig | undefined {
  if (!rake.enabled) return undefined;
  return { enabled: true, percent: rake.percent, cap: rake.caps[stake.id] ?? 5, noFlopNoDrop: rake.noFlopNoDrop };
}

export interface ActiveTable {
  sessionId: string;
  stake: Stake;
  startedAt: number;
  /** Total bought in this session (buy-in, rebuys and top-ups). */
  boughtIn: number;
  hands: number;
  ctl: TableController;
  director: AiDirector;
}

/** A table you are looking at before sitting down. */
export interface TablePreview {
  stake: Stake;
  seats: Array<Occupant | null>;
  buttonState: ButtonState;
  seating: Seating;
  director: AiDirector;
}

export interface SessionSummary {
  sessionId: string;
  stake: Stake;
  boughtIn: number;
  cashedOut: number;
  hands: number;
}

export interface StoreSnapshot {
  loaded: boolean;
  profile: Profile;
  rake: RakeSettings;
  table: ActiveTable | null;
  lastSession: SessionSummary | null;
  /** Set if saving to the browser fails (e.g. private browsing). */
  storageError: string | null;
  /** The last finished hand you played (for "copy hand history"). */
  lastRecord: HandRecord | null;
  /** Your label and notes on each player, by player id. */
  notes: Record<string, PlayerNote>;
  /** Everything you've observed about each player, across all hands you've played. */
  observed: Record<string, StatCounts>;
}

interface SavedTable {
  version: 1;
  sessionId: string;
  stakeId: string;
  startedAt: number;
  boughtIn: number;
  hands: number;
  controller: ControllerState;
  director: DirectorState;
}

export interface StoreOptions {
  db?: PokerDb;
  rng?: Rng;
  scheduler?: Scheduler;
  /** Table settings (speed, practice mode, ...) for new and restored tables. */
  tableSettings?: () => Partial<TableSettings>;
  /** How long to wait before saving after a change (ms). */
  saveDelayMs?: number;
}

export class GameStore {
  private snap: StoreSnapshot = {
    loaded: false,
    profile: { bankroll: START_BANKROLL, createdAt: Date.now(), resets: 0 },
    rake: DEFAULT_RAKE,
    table: null,
    lastSession: null,
    storageError: null,
    lastRecord: null,
    notes: {},
    observed: {},
  };
  private lastHandId = 0;
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeTable: (() => void) | null = null;
  private readonly db: PokerDb;
  private readonly rng: Rng;
  private readonly opts: StoreOptions;

  constructor(opts: StoreOptions = {}) {
    this.opts = opts;
    this.db = opts.db ?? getDb();
    this.rng = opts.rng ?? secureRng;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): StoreSnapshot => this.snap;

  private update(patch: Partial<StoreSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }

  /* ---------------- loading and saving ---------------- */

  async load(): Promise<void> {
    try {
      const [profileRow, rakeRow, tableRow] = await Promise.all([
        this.db.kv.get('profile'),
        this.db.kv.get('rake'),
        this.db.kv.get('activeTable'),
      ]);
      let profile = profileRow?.value as Profile | undefined;
      if (!profile) {
        profile = { bankroll: START_BANKROLL, createdAt: Date.now(), resets: 0 };
        await this.db.transaction('rw', this.db.kv, this.db.bankroll, async () => {
          await this.db.kv.put({ key: 'profile', value: profile });
          await this.db.bankroll.add({ ts: Date.now(), bankroll: START_BANKROLL, onTable: 0, reason: 'start' });
        });
      }
      const rake = { ...DEFAULT_RAKE, ...(rakeRow?.value as Partial<RakeSettings> | undefined) };
      const lastHand = await this.db.hands.orderBy('id').last();
      this.lastHandId = lastHand?.id ?? 0;
      const saved = tableRow?.value as SavedTable | undefined;
      const table = saved?.version === 1 ? this.restoreTable(saved, rake) : null;
      const notes: Record<string, PlayerNote> = {};
      for (const n of await this.db.notes.toArray()) notes[n.playerId] = n;
      let observed: Record<string, StatCounts> = {};
      for (const o of await this.db.observed.toArray()) observed[o.playerId] = o.counts;
      if (Object.keys(observed).length === 0 && lastHand) observed = await this.rebuildObserved();
      this.update({ loaded: true, profile, rake, table, notes, observed });
    } catch (e) {
      this.update({ loaded: true, storageError: `Could not open saved data: ${(e as Error).message}` });
    }
  }

  private serializeTable(t: ActiveTable): SavedTable {
    return {
      version: 1,
      sessionId: t.sessionId,
      stakeId: t.stake.id,
      startedAt: t.startedAt,
      boughtIn: t.boughtIn,
      hands: t.hands,
      controller: t.ctl.exportState(),
      director: t.director.exportState(),
    };
  }

  /** Saves the profile and the table together, so they never disagree. */
  async saveNow(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const { profile, table } = this.snap;
    try {
      await this.db.transaction('rw', this.db.kv, async () => {
        await this.db.kv.put({ key: 'profile', value: profile });
        if (table && !table.ctl.getSnapshot().closed) await this.db.kv.put({ key: 'activeTable', value: this.serializeTable(table) });
        else await this.db.kv.delete('activeTable');
      });
    } catch (e) {
      this.update({ storageError: `Could not save: ${(e as Error).message}` });
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => void this.saveNow(), this.opts.saveDelayMs ?? 120);
  }

  private async logPoint(p: Omit<BankrollPoint, 'id' | 'ts'>): Promise<void> {
    try {
      await this.db.bankroll.add({ ts: Date.now(), ...p });
    } catch {
      /* the chart is a convenience; never block play on it */
    }
  }

  /* ---------------- tables ---------------- */

  private makeController(stake: Stake, director: AiDirector, init: {
    restore?: ControllerState;
    heroSeat?: number;
    heroStack?: number;
    heroStatus?: 'waitingForBB' | 'postToEnter' | 'active';
    seats?: Array<Occupant | null>;
    buttonState?: ButtonState;
  }, rake: RakeSettings): TableController {
    const table = {
      id: stake.id, name: stake.name, smallBlind: stake.smallBlind, bigBlind: stake.bigBlind, numSeats: 10,
      rake: rakeConfigFor(rake, stake),
    };
    return new TableController({
      table,
      heroSeat: init.heroSeat ?? init.restore!.heroSeat,
      heroStack: init.heroStack ?? 0,
      heroStatus: init.heroStatus,
      bots: (init.seats ?? []).filter((o): o is Occupant => !!o && !o.isHero).map(({ seat, id, name, stack }) => ({ seat, id, name, stack })),
      buttonState: init.buttonState,
      restore: init.restore,
      hooks: director,
      rng: this.rng,
      scheduler: this.opts.scheduler,
      settings: this.opts.tableSettings?.(),
      onLeave: (stack) => void this.handleLeave(stack),
      onHandComplete: (hand) => this.handleHandComplete(hand),
    });
  }

  private attach(t: ActiveTable): void {
    this.unsubscribeTable?.();
    this.unsubscribeTable = t.ctl.subscribe(() => this.scheduleSave());
  }

  private restoreTable(saved: SavedTable, rake: RakeSettings): ActiveTable | null {
    let stake: Stake;
    try {
      stake = stakeById(saved.stakeId);
    } catch {
      return null;
    }
    const seating = new Seating(stake, this.rng);
    const director = new AiDirector(seating, this.rng);
    director.importState(saved.director);
    const ctl = this.makeController(stake, director, { restore: saved.controller }, rake);
    const t: ActiveTable = {
      sessionId: saved.sessionId, stake, startedAt: saved.startedAt, boughtIn: saved.boughtIn, hands: saved.hands, ctl, director,
    };
    this.attach(t);
    return t;
  }

  canAfford(stake: Stake): boolean {
    return this.snap.profile.bankroll >= stake.minBuyIn;
  }

  buyInRange(stake: Stake): { min: number; max: number } {
    return { min: stake.minBuyIn, max: Math.min(stake.maxBuyIn ?? Infinity, this.snap.profile.bankroll) };
  }

  /** Fills a table with players and a game already in progress, for you to pick a seat. */
  previewTable(stake: Stake): TablePreview {
    const seating = new Seating(stake, this.rng);
    const director = new AiDirector(seating, this.rng);
    const seats = seating.initialFill(Array.from({ length: 10 }, () => null));
    const occupied = seats.filter((o): o is Occupant => !!o).map((o) => o.seat);
    const bbIdx = this.rng.int(occupied.length);
    const buttonState: ButtonState = {
      lastBBSeat: occupied[bbIdx],
      lastSBPos: occupied[(bbIdx - 1 + occupied.length) % occupied.length],
    };
    return { stake, seats, buttonState, seating, director };
  }

  /** Sits you down: the buy-in leaves your bankroll and goes in front of you. */
  async sitDown(preview: TablePreview, seat: number, amount: number, entry: 'post' | 'wait'): Promise<string | null> {
    if (this.snap.table) return 'You are already seated at a table.';
    const { min, max } = this.buyInRange(preview.stake);
    if (!Number.isInteger(amount) || amount < min || amount > max) return `Buy-in must be between $${min} and $${max}.`;
    if (preview.seats[seat]) return 'That seat is taken.';
    const ctl = this.makeController(preview.stake, preview.director, {
      heroSeat: seat,
      heroStack: amount,
      heroStatus: entry === 'post' ? 'postToEnter' : 'waitingForBB',
      seats: preview.seats,
      buttonState: preview.buttonState,
    }, this.snap.rake);
    const sessionId = `${preview.stake.id}-${Date.now().toString(36)}-${this.rng.int(1e9).toString(36)}`;
    const startedAt = Date.now();
    const table: ActiveTable = { sessionId, stake: preview.stake, startedAt, boughtIn: amount, hands: 0, ctl, director: preview.director };
    const profile = { ...this.snap.profile, bankroll: this.snap.profile.bankroll - amount };
    this.update({ profile, table, lastSession: null });
    this.attach(table);
    await this.saveNow();
    await this.db.sessions.put({ id: sessionId, stakeId: preview.stake.id, startedAt, endedAt: null, boughtIn: amount, cashedOut: null, hands: 0 }).catch(() => {});
    await this.logPoint({ bankroll: profile.bankroll, onTable: amount, reason: 'buyin', stakeId: preview.stake.id, sessionId });
    void requestPersistentStorage();
    return null;
  }

  /** How much you may add right now (rebuy after busting, or top up). */
  addChipsRange(): { min: number; max: number } | null {
    const t = this.snap.table;
    if (!t || !t.ctl.canAddChips()) return null;
    const stack = t.ctl.heroStack();
    const bankroll = this.snap.profile.bankroll;
    const roomAtTable = t.stake.maxBuyIn === null ? Infinity : t.stake.maxBuyIn - stack;
    const max = Math.min(roomAtTable, bankroll);
    // After busting you must rebuy for at least the table minimum.
    const min = stack === 0 ? t.stake.minBuyIn : 1;
    return max >= min ? { min, max } : null;
  }

  async addChips(amount: number): Promise<string | null> {
    const t = this.snap.table;
    const range = this.addChipsRange();
    if (!t || !range) return 'You cannot add chips right now.';
    if (!Number.isInteger(amount) || amount < range.min || amount > range.max) {
      return `You can add between $${range.min} and $${range.max}.`;
    }
    t.ctl.addHeroChips(amount);
    const profile = { ...this.snap.profile, bankroll: this.snap.profile.bankroll - amount };
    const table = { ...t, boughtIn: t.boughtIn + amount };
    this.update({ profile, table });
    await this.saveNow();
    await this.db.sessions.update(t.sessionId, { boughtIn: table.boughtIn }).catch(() => {});
    await this.logPoint({ bankroll: profile.bankroll, onTable: t.ctl.heroStack(), reason: 'addchips', stakeId: t.stake.id, sessionId: t.sessionId });
    return null;
  }

  /** Leave the table (now, or after the hand you're playing). */
  leave(): void {
    this.snap.table?.ctl.requestLeave();
  }

  private async handleLeave(stack: number): Promise<void> {
    const t = this.snap.table;
    if (!t) return;
    this.unsubscribeTable?.();
    this.unsubscribeTable = null;
    t.ctl.suspend();
    const profile = { ...this.snap.profile, bankroll: this.snap.profile.bankroll + stack };
    const lastSession: SessionSummary = { sessionId: t.sessionId, stake: t.stake, boughtIn: t.boughtIn, cashedOut: stack, hands: t.hands };
    this.update({ profile, table: null, lastSession });
    await this.saveNow();
    await this.db.sessions.update(t.sessionId, { endedAt: Date.now(), cashedOut: stack, hands: t.hands }).catch(() => {});
    await this.logPoint({ bankroll: profile.bankroll, onTable: 0, reason: 'cashout', stakeId: t.stake.id, sessionId: t.sessionId });
  }

  private handleHandComplete(hand: HandState): void {
    const t = this.snap.table;
    if (!t) return;
    const hero = hand.players.find((p) => p.seat === t.ctl.getSnapshot().heroSeat);
    if (!hero) return; // you weren't dealt in
    const table = { ...t, hands: t.hands + 1 };
    const id = Math.max(Date.now(), this.lastHandId + 1);
    this.lastHandId = id;
    const record = makeRecord(hand, {
      id,
      sessionId: t.sessionId,
      stakeId: t.stake.id,
      stakesLabel: t.stake.label,
      tableName: t.stake.name,
      heroSeat: hero.seat,
      practiceMode: t.ctl.getSnapshot().settings.practiceMode,
    });
    // What you saw this hand goes into your all-time read on each player.
    const counts = new Map<string, StatCounts>(
      hand.players.map((p) => [p.id, { ...(this.snap.observed[p.id] ?? emptyCounts()) }]),
    );
    recordHand(hand, counts);
    const observed = { ...this.snap.observed, ...Object.fromEntries(counts) };
    this.update({ table, lastRecord: record, observed });
    void this.db.observed
      .bulkPut([...counts].map(([playerId, c]) => ({ playerId, counts: c, lastSeen: record.endedAt })))
      .catch(() => {});
    void this.db.hands.put(record).catch((e) => this.update({ storageError: `Could not save hand history: ${(e as Error).message}` }));
    void this.db.sessions.update(t.sessionId, { hands: table.hands }).catch(() => {});
    void this.logPoint({ bankroll: this.snap.profile.bankroll, onTable: hero.stack, reason: 'hand', stakeId: t.stake.id, sessionId: t.sessionId });
  }

  /* ---------------- bankroll reset and settings ---------------- */

  /** A fresh $2,000 is offered once you can't afford any table and have no chips in play. */
  canReset(): boolean {
    return !this.snap.table && this.snap.profile.bankroll < SMALLEST_BUY_IN;
  }

  async resetBankroll(): Promise<void> {
    if (!this.canReset()) return;
    const profile = { ...this.snap.profile, bankroll: START_BANKROLL, resets: this.snap.profile.resets + 1 };
    this.update({ profile });
    await this.saveNow();
    await this.logPoint({ bankroll: START_BANKROLL, onTable: 0, reason: 'reset' });
  }

  async setRake(rake: RakeSettings): Promise<void> {
    this.update({ rake });
    this.snap.table?.ctl.setRake(rakeConfigFor(rake, this.snap.table.stake));
    try {
      await this.db.kv.put({ key: 'rake', value: rake });
    } catch {
      /* ignore */
    }
    this.scheduleSave();
  }

  /* ---------------- notes on players ---------------- */

  labelFor = (playerId: string): ReadLabel | undefined => this.snap.notes[playerId]?.label;

  async setNote(playerId: string, patch: { label?: ReadLabel; text?: string }): Promise<void> {
    const prev = this.snap.notes[playerId] ?? { playerId, label: 'Unknown' as ReadLabel, text: '', updatedAt: 0 };
    const next: PlayerNote = { ...prev, ...patch, updatedAt: Date.now() };
    const notes = { ...this.snap.notes };
    const empty = next.label === 'Unknown' && next.text.trim() === '';
    if (empty) delete notes[playerId];
    else notes[playerId] = next;
    this.update({ notes });
    try {
      if (empty) await this.db.notes.delete(playerId);
      else await this.db.notes.put(next);
    } catch (e) {
      this.update({ storageError: `Could not save note: ${(e as Error).message}` });
    }
  }

  /** Recomputes your observed stats on every player from all saved hands. */
  async rebuildObserved(): Promise<Record<string, StatCounts>> {
    const counts = new Map<string, StatCounts>();
    const lastSeen = new Map<string, number>();
    await this.db.hands.orderBy('id').each((r) => {
      recordHand(r.hand as unknown as HandState, counts);
      for (const p of r.hand.players) lastSeen.set(p.id, r.endedAt);
    });
    await this.db.observed.clear();
    await this.db.observed.bulkPut([...counts].map(([playerId, c]) => ({ playerId, counts: c, lastSeen: lastSeen.get(playerId) ?? 0 })));
    return Object.fromEntries(counts);
  }

  dismissLastSession(): void {
    this.update({ lastSession: null });
  }
}
