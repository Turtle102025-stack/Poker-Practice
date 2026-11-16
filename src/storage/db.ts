import Dexie, { type Table } from 'dexie';

/**
 * Everything saved in the browser (IndexedDB). It survives page refreshes and
 * browser restarts. It lives only in this browser on this device.
 */

export interface KvRow {
  key: string;
  value: unknown;
}

/** One point on the bankroll-over-time chart. */
export interface BankrollPoint {
  id?: number;
  ts: number;
  /** Money off the table. */
  bankroll: number;
  /** Chips in front of you at a table. */
  onTable: number;
  reason: 'start' | 'buyin' | 'addchips' | 'hand' | 'cashout' | 'reset';
  stakeId?: string;
  sessionId?: string;
}

/** One sitting at one table, from sitting down to leaving. */
export interface SessionRow {
  id: string;
  stakeId: string;
  startedAt: number;
  endedAt: number | null;
  /** Total bought in (first buy-in plus rebuys and top-ups). */
  boughtIn: number;
  /** Chips taken off the table when leaving. */
  cashedOut: number | null;
  hands: number;
}

export class PokerDb extends Dexie {
  kv!: Table<KvRow, string>;
  bankroll!: Table<BankrollPoint, number>;
  sessions!: Table<SessionRow, string>;

  constructor(name = 'poker-practice') {
    super(name);
    this.version(1).stores({
      kv: 'key',
      bankroll: '++id, ts',
      sessions: 'id, startedAt, stakeId',
    });
  }
}

let instance: PokerDb | null = null;

export function getDb(): PokerDb {
  if (!instance) instance = new PokerDb();
  return instance;
}

/** For tests: use a fresh database. */
export function setDb(db: PokerDb): void {
  instance = db;
}

/** Asks the browser not to clear this site's data when storage runs low. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
