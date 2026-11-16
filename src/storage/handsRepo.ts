import type { HandRecord } from '../history/record';
import { getDb, type PokerDb } from './db';

/** Which hands to look at: a session, a time range, or everything. */
export interface HandQuery {
  sessionId?: string;
  /** ms since epoch, inclusive */
  from?: number;
  /** ms since epoch, exclusive */
  to?: number;
}

function collection(db: PokerDb, q: HandQuery) {
  if (q.sessionId) return db.hands.where('sessionId').equals(q.sessionId);
  if (q.from !== undefined || q.to !== undefined) {
    return db.hands.where('endedAt').between(q.from ?? 0, q.to ?? Number.MAX_SAFE_INTEGER, true, false);
  }
  return db.hands.toCollection();
}

/** Hands matching the query, oldest first (or newest first with `newestFirst`). */
export async function queryHands(q: HandQuery, opts: { limit?: number; offset?: number; newestFirst?: boolean } = {}, db = getDb()): Promise<HandRecord[]> {
  let rows = await collection(db, q).sortBy('id');
  if (opts.newestFirst) rows = rows.reverse();
  const start = opts.offset ?? 0;
  return opts.limit === undefined ? rows.slice(start) : rows.slice(start, start + opts.limit);
}

export async function summarizeHands(q: HandQuery, db = getDb()): Promise<{ count: number; net: number }> {
  let count = 0;
  let net = 0;
  await collection(db, q).each((r) => {
    count++;
    net += r.heroNet;
  });
  return { count, net };
}
