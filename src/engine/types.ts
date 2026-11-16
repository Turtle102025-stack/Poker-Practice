import type { Card } from './cards';
import type { HandValue } from './evaluator';
import type { Position } from './positions';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type Phase = Street | 'complete';

export interface RakeConfig {
  enabled: boolean;
  /** Percent of the pot, e.g. 10 for 10%. */
  percent: number;
  /** Maximum rake per hand in dollars. */
  cap: number;
  /** No rake when the hand ends before the flop. */
  noFlopNoDrop: boolean;
}

export interface HandPlayerInit {
  seat: number;
  id: string;
  name: string;
  stack: number;
}

export interface HandConfig {
  handId: string;
  /** Number of seats at the table (positions are seat indexes 0..numSeats-1). */
  numSeats: number;
  smallBlind: number;
  bigBlind: number;
  /** Everyone dealt into this hand. */
  players: HandPlayerInit[];
  /** Seat index of the button. If no dealt-in player sits there, the button is dead. */
  buttonSeat: number;
  /** Seat posting the small blind, or null when there is no small blind (dead small blind). */
  sbSeat: number | null;
  bbSeat: number;
  /** New players posting a live big blind to enter the game out of position. */
  livePosters?: number[];
  /** Seat posting a UTG straddle (two big blinds), if any. */
  straddleSeat?: number | null;
  rake?: RakeConfig;
  /** When the hand started (ms since epoch), for hand histories. */
  startedAt?: number;
}

export interface PlayerState {
  seat: number;
  id: string;
  name: string;
  startStack: number;
  /** Chips behind (not yet in the pot). */
  stack: number;
  hole: Card[];
  /** Chips put in on the current street. */
  committed: number;
  /** Chips put in during the whole hand. */
  totalCommitted: number;
  folded: boolean;
  allIn: boolean;
  /** Has voluntarily acted on this street (posting a blind does not count). */
  hasActed: boolean;
  position: Position;
  /** Showed cards at showdown. */
  shown: boolean;
  /** Reached showdown and threw the hand away without showing. */
  mucked: boolean;
}

export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise';
export type PostKind = 'sb' | 'bb' | 'straddle' | 'live-bb';

/** A chip-moving decision (or forced post) by one player. */
export interface BetEvent {
  type: 'bet';
  seat: number;
  street: Street;
  action: ActionKind | 'post';
  postKind?: PostKind;
  /** Chips this action added to the pot. */
  amount: number;
  /** The player's total on this street after acting ("raise to"). */
  toAmount: number;
  /** Amount the player needed to call before acting (not capped by stack). */
  facing: number;
  allIn: boolean;
  /** For bets and raises: whether it was a full bet/raise that reopens the action. */
  fullRaise?: boolean;
  potBefore: number;
  potAfter: number;
  stackBefore: number;
  stackAfter: number;
  board: Card[];
}

export interface StreetEvent {
  type: 'street';
  street: Street;
  cards: Card[];
  board: Card[];
  /** Pot at the start of the street. */
  pot: number;
}

export interface UncalledEvent {
  type: 'uncalled';
  seat: number;
  street: Street;
  amount: number;
}

export interface ShowEvent {
  type: 'show';
  seat: number;
  cards: Card[];
  value: HandValue;
  description: string;
}

export interface MuckEvent {
  type: 'muck';
  seat: number;
}

export interface RakeEvent {
  type: 'rake';
  amount: number;
}

export interface AwardEvent {
  type: 'award';
  seat: number;
  amount: number;
  /** 0 = main pot, 1+ = side pots. */
  potIndex: number;
  potCount: number;
  /** Hand description when won at showdown. */
  description?: string;
}

export type HandEvent =
  | BetEvent
  | StreetEvent
  | UncalledEvent
  | ShowEvent
  | MuckEvent
  | RakeEvent
  | AwardEvent;

export interface Pot {
  amount: number;
  /** Seats that can win this pot. */
  eligible: number[];
}

export interface HandResult {
  /** Pots after rake. */
  pots: Pot[];
  rake: number;
  /** Total chips awarded to each seat. */
  winnings: Record<number, number>;
  /** Net result per seat (final stack minus starting stack). */
  net: Record<number, number>;
  wentToShowdown: boolean;
}

export interface HandState {
  config: HandConfig;
  /** The full shuffled deck. Hidden information: never shown to players. */
  deck: readonly Card[];
  deckPos: number;
  board: Card[];
  /** Sorted by seat. */
  players: PlayerState[];
  phase: Phase;
  /** Highest total any player must match on this street. */
  currentBet: number;
  /** Size of the last full bet or raise on this street (the minimum raise increment). */
  minRaise: number;
  /** Seat whose turn it is, or null. */
  toAct: number | null;
  /** Last player to bet or raise on the most recent betting street. */
  lastAggressor: number | null;
  /** True when the remaining board was dealt with no betting possible (all-in). */
  ranOut: boolean;
  events: HandEvent[];
  result: HandResult | null;
}

export type PlayerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; to: number }
  | { type: 'raise'; to: number }
  | { type: 'allin' };

export interface LegalActions {
  seat: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Chips needed to call (capped by the player's stack). */
  callAmount: number;
  /** Full amount to call, ignoring stack size. */
  facing: number;
  /** Whether a bet or raise is allowed. */
  canRaise: boolean;
  /** True when nobody has bet yet on this street, so the action is a "bet". */
  isBet: boolean;
  /** Smallest legal bet/raise, as the player's street total ("to" amount). */
  minTo: number;
  /** Largest legal bet/raise (all-in), as the player's street total. */
  maxTo: number;
  /** Why raising is not allowed, if it isn't. */
  raiseBlockedReason?: string;
}

export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalActionError';
  }
}
