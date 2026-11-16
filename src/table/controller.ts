import { basicBotDecide } from '../ai/basicBot';
import { shuffledDeck } from '../engine/deck';
import { applyAction, startHand } from '../engine/hand';
import { secureRng, type Rng } from '../engine/rng';
import { NEW_BUTTON_STATE, planNextHand, type ButtonState, type SeatStatus } from '../engine/table';
import { IllegalActionError, type HandConfig, type HandState, type PlayerAction } from '../engine/types';
import { getPlayerView, type PlayerView } from '../engine/view';

/**
 * Runs one table: seats, dealing, asking computer players for decisions on a
 * timer, waiting for the human, and dealing the next hand. It has no UI code;
 * React subscribes to snapshots.
 */

export type AiSpeed = 'slow' | 'normal' | 'fast' | 'instant';
export const AI_DELAY_MS: Record<AiSpeed, number> = { slow: 1800, normal: 1000, fast: 450, instant: 40 };
const FAST_FORWARD_MS = 25;

export interface TableSettings {
  aiSpeed: AiSpeed;
  /** Delay before dealing the next hand automatically; null = wait for me. */
  autoDealMs: number | null;
  /** Wait for me after any showdown I was part of. */
  pauseAfterMyShowdown: boolean;
  /** Skip to the end of the hand automatically after I fold. */
  autoFastForward: boolean;
  /** Show every player's hole cards when the hand ends. */
  practiceMode: boolean;
  /** Post a straddle when I'm under the gun. */
  straddle: boolean;
  fourColorDeck: boolean;
  showHandStrength: boolean;
}

export const DEFAULT_SETTINGS: TableSettings = {
  aiSpeed: 'normal',
  autoDealMs: 2500,
  pauseAfterMyShowdown: true,
  autoFastForward: false,
  practiceMode: true,
  straddle: false,
  fourColorDeck: false,
  showHandStrength: true,
};

export interface TableInfo {
  id: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  numSeats: number;
}

export interface Occupant {
  seat: number;
  id: string;
  name: string;
  stack: number;
  status: SeatStatus;
  isHero: boolean;
}

export type Stage = 'in-hand' | 'hand-over';

export interface TableSnapshot {
  table: TableInfo;
  seats: Array<Occupant | null>;
  heroSeat: number;
  hand: HandState | null;
  handNo: number;
  stage: Stage;
  /** When the next hand will be dealt automatically (ms since epoch), or null. */
  autoDealAt: number | null;
  fastForward: boolean;
  paused: boolean;
  /** When the current player started thinking (for the timer bar). */
  actingSince: number | null;
  notices: string[];
  settings: TableSettings;
}

/** A computer player's decision function. Receives only its own view of the hand. */
export type BotBrain = (view: PlayerView, rng: Rng) => PlayerAction;

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export interface ControllerOptions {
  table: TableInfo;
  heroSeat: number;
  heroName?: string;
  heroStack: number;
  bots: Array<{ seat: number; id: string; name: string; stack: number }>;
  /** Stack a busted player rebuys for (Phase 2: free rebuys). */
  rebuyStack: number;
  settings?: Partial<TableSettings>;
  brain?: BotBrain;
  rng?: Rng;
  scheduler?: Scheduler;
}

export class TableController {
  private snap: TableSnapshot;
  private listeners = new Set<() => void>();
  private timer: unknown = null;
  private buttonState: ButtonState = NEW_BUTTON_STATE;
  private readonly brain: BotBrain;
  private readonly rng: Rng;
  private readonly sched: Scheduler;
  private readonly rebuyStack: number;

  constructor(opts: ControllerOptions) {
    this.brain = opts.brain ?? basicBotDecide;
    this.rng = opts.rng ?? secureRng;
    this.sched = opts.scheduler ?? realScheduler;
    this.rebuyStack = opts.rebuyStack;
    const seats: Array<Occupant | null> = Array.from({ length: opts.table.numSeats }, () => null);
    seats[opts.heroSeat] = {
      seat: opts.heroSeat, id: 'hero', name: opts.heroName ?? 'You', stack: opts.heroStack, status: 'active', isHero: true,
    };
    for (const b of opts.bots) seats[b.seat] = { ...b, status: 'active', isHero: false };
    this.snap = {
      table: opts.table,
      seats,
      heroSeat: opts.heroSeat,
      hand: null,
      handNo: 0,
      stage: 'hand-over',
      autoDealAt: null,
      fastForward: false,
      paused: false,
      actingSince: null,
      notices: [],
      settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    };
  }

  /* ---------------- subscription (for React's useSyncExternalStore) -------------- */

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): TableSnapshot => this.snap;

  private update(patch: Partial<TableSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }

  /* ---------------- public commands ------------------------------------------- */

  /** Deals the first hand, or re-arms timers after suspend(). Safe to call repeatedly. */
  start(): void {
    if (!this.snap.hand) {
      this.deal();
      return;
    }
    if (this.timer !== null) return;
    if (this.snap.stage === 'in-hand') this.step();
    else if (this.snap.autoDealAt !== null) {
      const wait = Math.max(0, this.snap.autoDealAt - this.sched.now());
      this.later(() => this.deal(), wait);
    }
  }

  /** Stops timers (e.g. when the page unmounts). start() resumes. */
  suspend(): void {
    this.clearTimer();
  }

  /** Deals the next hand now (between hands only). */
  dealNow(): void {
    if (this.snap.stage === 'in-hand') return;
    this.deal();
  }

  /** Your action. Returns an error message if it was not allowed. */
  heroAct(action: PlayerAction): string | null {
    const s = this.snap;
    if (!s.hand || s.stage !== 'in-hand' || s.hand.toAct !== s.heroSeat) return 'It is not your turn.';
    try {
      const hand = applyAction(s.hand, s.heroSeat, action);
      const ff = action.type === 'fold' && s.settings.autoFastForward;
      this.update({ hand, fastForward: s.fastForward || ff });
      this.step();
      return null;
    } catch (e) {
      if (e instanceof IllegalActionError) return e.message;
      throw e;
    }
  }

  /** Plays the rest of the current hand with no delays. */
  fastForward(): void {
    if (this.snap.stage !== 'in-hand' || this.snap.fastForward) return;
    this.update({ fastForward: true });
    this.step();
  }

  setPaused(paused: boolean): void {
    if (paused === this.snap.paused) return;
    this.clearTimer();
    this.update({ paused, autoDealAt: null });
    if (this.snap.stage === 'in-hand') this.step();
    else this.scheduleAutoDeal(false);
  }

  updateSettings(patch: Partial<TableSettings>): void {
    this.update({ settings: { ...this.snap.settings, ...patch } });
    if (this.snap.stage === 'hand-over' && 'autoDealMs' in patch) {
      this.clearTimer();
      this.scheduleAutoDeal(false);
    }
  }

  /** Adds chips to your stack between hands, up to `max`. */
  topUpHero(max: number): void {
    if (this.snap.stage === 'in-hand') return;
    const seats = this.snap.seats.slice();
    const hero = seats[this.snap.heroSeat]!;
    if (hero.stack >= max) return;
    seats[this.snap.heroSeat] = { ...hero, stack: max };
    this.update({ seats, notices: [...this.snap.notices, `You topped up to $${max}.`] });
  }

  destroy(): void {
    this.clearTimer();
    this.listeners.clear();
  }

  /* ---------------- the game loop --------------------------------------------- */

  private clearTimer(): void {
    if (this.timer !== null) this.sched.clearTimeout(this.timer);
    this.timer = null;
  }

  private later(fn: () => void, ms: number): void {
    this.clearTimer();
    this.timer = this.sched.setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
  }

  private deal(): void {
    this.clearTimer();
    const notices: string[] = [];
    const bb = this.snap.table.bigBlind;

    // Busted players rebuy (free in Phase 2).
    const seats = this.snap.seats.map((o) => {
      if (!o || o.stack > 0) return o;
      notices.push(o.isHero ? `You rebought for $${this.rebuyStack}.` : `${o.name} rebought for $${this.rebuyStack}.`);
      return { ...o, stack: this.rebuyStack };
    });

    const present = seats.filter((o): o is Occupant => !!o);
    const plan = planNextHand(
      present.map((o) => ({ seat: o.seat, stack: o.stack, status: o.status })),
      this.snap.table.numSeats,
      this.buttonState,
      this.rng,
    );
    if (!plan) {
      this.update({ seats, notices: [...notices, 'Waiting for more players.'], stage: 'hand-over', hand: null });
      return;
    }
    this.buttonState = plan.next;
    for (const seat of plan.entering) seats[seat] = { ...seats[seat]!, status: 'active' };

    // Your straddle, when you're under the gun.
    let straddleSeat: number | null = null;
    const hero = seats[this.snap.heroSeat];
    if (this.snap.settings.straddle && hero && plan.dealtIn.length >= 4) {
      const afterBB = [...plan.dealtIn.filter((x) => x > plan.bbSeat), ...plan.dealtIn.filter((x) => x <= plan.bbSeat)];
      if (afterBB[0] === hero.seat && !plan.livePosters.includes(hero.seat) && hero.stack > 2 * bb) {
        straddleSeat = hero.seat;
      }
    }

    const handNo = this.snap.handNo + 1;
    const config: HandConfig = {
      handId: `${this.snap.table.id}-${handNo}`,
      numSeats: this.snap.table.numSeats,
      smallBlind: this.snap.table.smallBlind,
      bigBlind: bb,
      players: plan.dealtIn.map((seat) => {
        const o = seats[seat]!;
        return { seat, id: o.id, name: o.name, stack: o.stack };
      }),
      buttonSeat: plan.buttonSeat,
      sbSeat: plan.sbSeat,
      bbSeat: plan.bbSeat,
      livePosters: plan.livePosters,
      straddleSeat,
    };
    const hand = startHand(config, shuffledDeck(this.rng));
    this.update({ seats, hand, handNo, stage: 'in-hand', autoDealAt: null, fastForward: false, notices });
    this.step();
  }

  /** Decides what happens next in the current hand. */
  private step(): void {
    const { hand, paused, fastForward, settings, heroSeat } = this.snap;
    if (!hand) return;
    if (hand.phase === 'complete') {
      this.finishHand();
      return;
    }
    const now = this.sched.now();
    if (hand.toAct === heroSeat) {
      this.clearTimer();
      this.update({ actingSince: now });
      return;
    }
    if (paused) {
      this.clearTimer();
      return;
    }
    const base = fastForward ? FAST_FORWARD_MS : AI_DELAY_MS[settings.aiSpeed];
    const delay = fastForward ? base : Math.round(base * (0.7 + 0.6 * this.rng.float()));
    this.update({ actingSince: now });
    this.later(() => this.botAct(), delay);
  }

  private botAct(): void {
    const hand = this.snap.hand;
    if (!hand || hand.phase === 'complete' || hand.toAct === null || hand.toAct === this.snap.heroSeat) return;
    const seat = hand.toAct;
    let next: HandState;
    try {
      next = applyAction(hand, seat, this.brain(getPlayerView(hand, seat), this.rng));
    } catch (e) {
      // A bot should never send an illegal action; if one does, it checks or folds.
      console.error('Bot error', e);
      const legal = getPlayerView(hand, seat).legal!;
      next = applyAction(hand, seat, legal.canCheck ? { type: 'check' } : { type: 'fold' });
    }
    this.update({ hand: next });
    this.step();
  }

  private finishHand(): void {
    const hand = this.snap.hand!;
    const seats = this.snap.seats.slice();
    for (const p of hand.players) {
      const o = seats[p.seat];
      if (o) seats[p.seat] = { ...o, stack: p.stack };
    }
    this.update({ seats, stage: 'hand-over', actingSince: null, fastForward: false });
    const hero = hand.players.find((p) => p.seat === this.snap.heroSeat);
    const heroAtShowdown = !!hero && !hero.folded && hand.result!.wentToShowdown;
    this.scheduleAutoDeal(heroAtShowdown);
  }

  private scheduleAutoDeal(heroAtShowdown: boolean): void {
    const { settings, paused } = this.snap;
    if (paused || settings.autoDealMs === null || (heroAtShowdown && settings.pauseAfterMyShowdown)) {
      this.update({ autoDealAt: null });
      return;
    }
    this.update({ autoDealAt: this.sched.now() + settings.autoDealMs });
    this.later(() => this.deal(), settings.autoDealMs);
  }
}
