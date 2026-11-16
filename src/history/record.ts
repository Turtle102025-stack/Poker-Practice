import type { HandState } from '../engine/types';

/**
 * A finished hand as it is saved for your history. It keeps everything needed
 * to rebuild the hand (cards, every action, results) but not the rest of the deck.
 */
export interface HandRecord {
  /** Unique, increasing hand number (also used as the PokerStars hand number). */
  id: number;
  /** When the hand started and ended (ms since epoch). */
  startedAt: number;
  endedAt: number;
  sessionId: string;
  stakeId: string;
  /** e.g. "$1/$3" */
  stakesLabel: string;
  tableName: string;
  heroSeat: number;
  /** Your result in this hand. */
  heroNet: number;
  /** Practice mode was on, so every player's hole cards were revealed. */
  practiceMode: boolean;
  hand: Omit<HandState, 'deck' | 'deckPos'>;
}

export interface RecordMeta {
  id: number;
  sessionId: string;
  stakeId: string;
  stakesLabel: string;
  tableName: string;
  heroSeat: number;
  practiceMode: boolean;
  endedAt?: number;
}

export function makeRecord(hand: HandState, meta: RecordMeta): HandRecord {
  if (hand.phase !== 'complete' || !hand.result) throw new Error('Only finished hands can be recorded');
  const { deck: _deck, deckPos: _pos, ...rest } = hand;
  void _deck;
  void _pos;
  const endedAt = meta.endedAt ?? Date.now();
  return {
    id: meta.id,
    startedAt: hand.config.startedAt ?? endedAt,
    endedAt,
    sessionId: meta.sessionId,
    stakeId: meta.stakeId,
    stakesLabel: meta.stakesLabel,
    tableName: meta.tableName,
    heroSeat: meta.heroSeat,
    heroNet: hand.result.net[meta.heroSeat] ?? 0,
    practiceMode: meta.practiceMode,
    hand: structuredCloneSafe(rest),
  };
}

function structuredCloneSafe<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** The name used for you in exported histories. */
export const HERO_NAME = 'Hero';

export function playerName(rec: HandRecord, seat: number): string {
  if (seat === rec.heroSeat) return HERO_NAME;
  return rec.hand.players.find((p) => p.seat === seat)?.name ?? `Seat ${seat + 1}`;
}
