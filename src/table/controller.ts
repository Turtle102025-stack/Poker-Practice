import { basicBotDecide } from '../ai/basicBot';
import { shuffledDeck } from '../engine/deck';
import { applyAction, startHand } from '../engine/hand';
import { secureRng, type Rng } from '../engine/rng';
import { NEW_BUTTON_STATE, planNextHand, type ButtonState, type SeatStatus } from '../engine/table';
import { IllegalActionError, type HandConfig, type HandState, type PlayerAction, type RakeConfig } from '../engine/types';
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
  /** Computer players may straddle. */
  aiStraddles: boolean;
  /** Show each player's true style on their seat (to check your reads). */
  revealStyles: boolean;
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
  aiStraddles: true,
  revealStyles: false,
  fourColorDeck: false,
  showHandStrength: true,
};

export interface TableInfo {
  id: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  numSeats: number;
  /** Rake taken from each pot (off when missing). */
  rake?: RakeConfig;
}

export interface Occupant {
  seat: number;
  /** Player id ('hero' for you, a roster id for computer players). */
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
  /** Table news since the last hand: arrivals, departures, rebuys. */
  notices: string[];
  /** Things that happened at the end of this hand (reactions to big pots). */
  afterNotes: string[];
  settings: TableSettings;
  /** You are out of chips: no more hands until you add chips or leave. */
  heroBusted: boolean;
  /** You asked to leave once the current hand is over. */
  leaveAfterHand: boolean;
  /** You have left; the table no longer runs. */
  closed: boolean;
}

/** Everything needed to rebuild a table exactly where it was (saved after every action). */
export interface ControllerState {
  table: TableInfo;
  seats: Array<Occupant | null>;
  heroSeat: number;
  hand: HandState | null;
  handNo: number;
  stage: Stage;
  notices: string[];
  afterNotes: string[];
  buttonState: ButtonState;
  heroBusted: boolean;
  leaveAfterHand: boolean;
}

/** How computer players are run. The default is the simple Phase 2 bot. */
export interface TableHooks {
  decide(occ: Occupant, view: PlayerView): PlayerAction;
  wantsStraddle(occ: Occupant): boolean;
  /** Rebuys, top-ups, departures and arrivals before the next hand. */
  betweenHands(seats: Array<Occupant | null>, handNo: number): { seats: Array<Occupant | null>; notices: string[] };
  /** Called when a hand finishes; returns notes to show. */
  afterHand(hand: HandState): string[];
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

/** Simple bots with free rebuys and no table changes (Phase 2 behaviour, used in tests). */
export function simpleHooks(rebuyStack: number, rng: Rng, brain: BotBrain = basicBotDecide): TableHooks {
  return {
    decide: (_occ, view) => brain(view, rng),
    wantsStraddle: () => false,
    betweenHands: (seats) => {
      const notices: string[] = [];
      const out = seats.map((o) => {
        if (!o || o.isHero || o.stack > 0) return o;
        notices.push(`${o.name} rebought for $${rebuyStack}.`);
        return { ...o, stack: rebuyStack };
      });
      return { seats: out, notices };
    },
    afterHand: () => [],
  };
}

export interface ControllerOptions {
  table: TableInfo;
  heroSeat: number;
  heroName?: string;
  heroStack: number;
  /** Computer players already seated. */
  bots: Array<{ seat: number; id: string; name: string; stack: number }>;
  /** If set, you rebuy for this much automatically (free) when you bust. Used by tests. */
  rebuyStack?: number;
  /** How you join: dealt in now, waiting for the big blind, or posting to come in. */
  heroStatus?: SeatStatus;
  /** Where the button and blinds were last hand (to join a game already in progress). */
  buttonState?: ButtonState;
  /** Rebuild a saved table instead of starting fresh. */
  restore?: ControllerState;
  /** Called when you leave the table, with the chips you take with you. */
  onLeave?: (stack: number) => void;
  /** Called after every completed hand. */
  onHandComplete?: (hand: HandState) => void;
  settings?: Partial<TableSettings>;
  hooks?: TableHooks;
  /** Shortcut for tests: a decision function for simple bots. */
  brain?: BotBrain;
  rng?: Rng;
  scheduler?: Scheduler;
}

export class TableController {
  private snap: TableSnapshot;
  private listeners = new Set<() => void>();
  private timer: unknown = null;
  private buttonState: ButtonState = NEW_BUTTON_STATE;
  private readonly hooks: TableHooks;
  private readonly rng: Rng;
  private readonly sched: Scheduler;
  private readonly rebuyStack: number | undefined;
  private readonly onLeave?: (stack: number) => void;
  private readonly onHandComplete?: (hand: HandState) => void;
  private restored = false;

  constructor(opts: ControllerOptions) {
    this.rng = opts.rng ?? secureRng;
    this.hooks = opts.hooks ?? simpleHooks(opts.rebuyStack ?? 0, this.rng, opts.brain);
    this.sched = opts.scheduler ?? realScheduler;
    this.rebuyStack = opts.rebuyStack;
    this.onLeave = opts.onLeave;
    this.onHandComplete = opts.onHandComplete;
    const base = {
      autoDealAt: null,
      fastForward: false,
      paused: false,
      actingSince: null,
      settings: { ...DEFAULT_SETTINGS, ...opts.settings },
      closed: false,
    };
    if (opts.restore) {
      const r = opts.restore;
      this.restored = true;
      this.buttonState = r.buttonState;
      this.snap = {
        ...base,
        table: r.table, seats: r.seats, heroSeat: r.heroSeat, hand: r.hand, handNo: r.handNo, stage: r.stage,
        notices: r.notices, afterNotes: r.afterNotes, heroBusted: r.heroBusted, leaveAfterHand: r.leaveAfterHand,
      };
      return;
    }
    if (opts.buttonState) this.buttonState = opts.buttonState;
    const seats: Array<Occupant | null> = Array.from({ length: opts.table.numSeats }, () => null);
    seats[opts.heroSeat] = {
      seat: opts.heroSeat, id: 'hero', name: opts.heroName ?? 'You', stack: opts.heroStack,
      status: opts.heroStatus ?? 'active', isHero: true,
    };
    for (const b of opts.bots) seats[b.seat] = { ...b, status: 'active', isHero: false };
    this.snap = {
      ...base,
      table: opts.table,
      seats,
      heroSeat: opts.heroSeat,
      hand: null,
      handNo: 0,
      stage: 'hand-over',
      notices: [],
      afterNotes: [],
      heroBusted: false,
      leaveAfterHand: false,
    };
  }

  /** The state to save so the table can be rebuilt exactly (see `restore`). */
  exportState(): ControllerState {
    const s = this.snap;
    return {
      table: s.table, seats: s.seats, heroSeat: s.heroSeat, hand: s.hand, handNo: s.handNo, stage: s.stage,
      notices: s.notices, afterNotes: s.afterNotes, buttonState: this.buttonState, heroBusted: s.heroBusted,
      leaveAfterHand: s.leaveAfterHand,
    };
  }

  /** Your chips right now (behind, not counting chips already in the pot). */
  heroStack(): number {
    const { hand, heroSeat, seats } = this.snap;
    const inHand = hand && hand.phase !== 'complete' ? hand.players.find((p) => p.seat === heroSeat) : undefined;
    return inHand ? inHand.stack : seats[heroSeat]?.stack ?? 0;
  }

  /** Whether you are in the current, unfinished hand (and haven't folded). */
  heroInHand(): boolean {
    const { hand, heroSeat } = this.snap;
    if (!hand || hand.phase === 'complete') return false;
    const p = hand.players.find((x) => x.seat === heroSeat);
    return !!p && !p.folded;
  }

  /** Chips can be added only when you're not in a hand. */
  canAddChips(): boolean {
    const { hand, heroSeat, closed } = this.snap;
    if (closed) return false;
    if (!hand || hand.phase === 'complete') return true;
    return !hand.players.some((p) => p.seat === heroSeat);
  }

  /** Adds chips to your stack (rebuy or top-up). The caller checks limits and the bankroll. */
  addHeroChips(amount: number): void {
    if (!this.canAddChips() || amount <= 0) return;
    const seats = this.snap.seats.slice();
    const hero = seats[this.snap.heroSeat]!;
    seats[this.snap.heroSeat] = { ...hero, stack: hero.stack + amount };
    const wasBusted = this.snap.heroBusted;
    this.update({ seats, heroBusted: false });
    if (wasBusted && this.snap.stage === 'hand-over') this.scheduleAutoDeal(false);
  }

  /** Leave now if you're not in a hand, otherwise as soon as the hand ends. */
  requestLeave(): void {
    if (this.snap.closed) return;
    if (this.heroInHand()) {
      this.update({ leaveAfterHand: true });
      return;
    }
    this.leaveNow();
  }

  cancelLeave(): void {
    this.update({ leaveAfterHand: false });
  }

  /** While waiting to come in: post a big blind instead, or go back to waiting for it. */
  setHeroEntry(status: 'waitingForBB' | 'postToEnter'): void {
    const seats = this.snap.seats.slice();
    const hero = seats[this.snap.heroSeat]!;
    if (hero.status === 'active') return;
    seats[this.snap.heroSeat] = { ...hero, status };
    this.update({ seats });
  }

  setRake(rake: RakeConfig | undefined): void {
    this.update({ table: { ...this.snap.table, rake } });
  }

  private leaveNow(): void {
    const stack = this.heroStack();
    this.clearTimer();
    this.update({ closed: true, leaveAfterHand: false, autoDealAt: null });
    this.onLeave?.(stack);
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
    if (this.snap.closed) return;
    if (!this.snap.hand) {
      if (!this.snap.heroBusted) this.deal();
      return;
    }
    if (this.timer !== null) return;
    if (this.restored) {
      this.restored = false;
      if (this.snap.stage === 'in-hand') this.step();
      return;
    }
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
    if (this.snap.stage === 'in-hand' || this.snap.closed) return;
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
    this.update({ seats, afterNotes: [...this.snap.afterNotes, `You topped up to $${max.toLocaleString('en-US')}.`] });
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
    const bb = this.snap.table.bigBlind;
    const notices = [...this.snap.afterNotes];

    // Table changes, then your free rebuy if you busted.
    const churn = this.hooks.betweenHands(this.snap.seats, this.snap.handNo);
    notices.push(...churn.notices);
    const seats = churn.seats.slice();
    const hero = seats[this.snap.heroSeat];
    if (hero && hero.stack === 0) {
      if (this.rebuyStack === undefined) {
        // Out of chips: wait for you to rebuy or leave.
        this.update({ seats, notices, afterNotes: [], heroBusted: true, autoDealAt: null });
        return;
      }
      seats[this.snap.heroSeat] = { ...hero, stack: this.rebuyStack };
      notices.push(`You rebought for $${this.rebuyStack}.`);
    }

    const present = seats.filter((o): o is Occupant => !!o);
    const plan = planNextHand(
      present.map((o) => ({ seat: o.seat, stack: o.stack, status: o.status })),
      this.snap.table.numSeats,
      this.buttonState,
      this.rng,
    );
    if (!plan) {
      this.update({ seats, notices: [...notices, 'Waiting for more players.'], afterNotes: [], stage: 'hand-over', hand: null });
      this.later(() => this.deal(), 1500);
      return;
    }
    this.buttonState = plan.next;
    for (const seat of plan.entering) seats[seat] = { ...seats[seat]!, status: 'active' };

    // Straddle by whoever is under the gun, if they want to.
    let straddleSeat: number | null = null;
    if (plan.dealtIn.length >= 4) {
      const afterBB = [...plan.dealtIn.filter((x) => x > plan.bbSeat), ...plan.dealtIn.filter((x) => x <= plan.bbSeat)];
      const utg = seats[afterBB[0]]!;
      const eligible = !plan.livePosters.includes(utg.seat) && utg.stack > 2 * bb;
      if (eligible) {
        if (utg.isHero && this.snap.settings.straddle) straddleSeat = utg.seat;
        else if (!utg.isHero && this.snap.settings.aiStraddles && this.hooks.wantsStraddle(utg)) straddleSeat = utg.seat;
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
      rake: this.snap.table.rake,
    };
    const hand = startHand(config, shuffledDeck(this.rng));
    this.update({ seats, hand, handNo, stage: 'in-hand', autoDealAt: null, fastForward: false, notices, afterNotes: [] });
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
    // The computer player decides now and "thinks" for a realistic time before acting.
    const seat = hand.toAct!;
    const view = getPlayerView(hand, seat);
    let action: PlayerAction;
    try {
      action = this.hooks.decide(this.snap.seats[seat]!, view);
    } catch (e) {
      console.error('Bot error', e);
      action = view.legal!.canCheck ? { type: 'check' } : { type: 'fold' };
    }
    const base = AI_DELAY_MS[settings.aiSpeed] * thinkFactor(action, view);
    const delay = fastForward ? FAST_FORWARD_MS : Math.round(base * (0.7 + 0.6 * this.rng.float()));
    this.update({ actingSince: now });
    this.later(() => this.botAct(seat, action), delay);
  }

  private botAct(seat: number, action: PlayerAction): void {
    const hand = this.snap.hand;
    if (!hand || hand.phase === 'complete' || hand.toAct !== seat) return;
    let next: HandState;
    try {
      next = applyAction(hand, seat, action);
    } catch (e) {
      // A computer player should never send an illegal action; if one does, it checks or folds.
      console.error('Illegal bot action', action, e);
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
    const afterNotes = this.hooks.afterHand(hand);
    this.update({ seats, stage: 'hand-over', actingSince: null, fastForward: false, afterNotes });
    this.onHandComplete?.(hand);
    if (this.snap.leaveAfterHand) {
      this.leaveNow();
      return;
    }
    const hero = hand.players.find((p) => p.seat === this.snap.heroSeat);
    const heroAtShowdown = !!hero && !hero.folded && hand.result!.wentToShowdown;
    this.scheduleAutoDeal(heroAtShowdown);
  }

  private scheduleAutoDeal(heroAtShowdown: boolean): void {
    const { settings, paused } = this.snap;
    if (this.snap.closed) return;
    if (paused || settings.autoDealMs === null || (heroAtShowdown && settings.pauseAfterMyShowdown)) {
      this.update({ autoDealAt: null });
      return;
    }
    this.update({ autoDealAt: this.sched.now() + settings.autoDealMs });
    this.later(() => this.deal(), settings.autoDealMs);
  }
}

/** Quick folds and checks, longer thought for big bets and all-ins. */
function thinkFactor(action: PlayerAction, view: PlayerView): number {
  const legal = view.legal!;
  const me = view.players.find((p) => p.seat === view.seat)!;
  if (action.type === 'allin' || legal.callAmount >= 0.4 * (me.stack + me.committed)) return 1.9;
  if (action.type === 'fold') return view.board.length === 0 ? 0.55 : 0.9;
  if (action.type === 'check') return 0.65;
  if (action.type === 'call') return 1;
  return 1.25;
}
