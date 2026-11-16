import type { BetEvent } from '../engine/types';
import type { HandRecord } from '../history/record';
import type { BankrollPoint, SessionRow } from '../storage/db';
import { STAKES } from '../table/stakes';

/** Your results, computed from saved hands, sessions and bankroll history. */
export interface ResultLine {
  key: string;
  label: string;
  hands: number;
  sessions?: number;
  net: number;
  /** Big blinds won per 100 hands. */
  bbPer100: number;
  vpip: number | null;
  pfr: number | null;
}

export interface StatsSummary {
  hands: number;
  sessions: number;
  /** Sum of your results in every hand. */
  handsNet: number;
  vpip: number | null;
  pfr: number | null;
  byStake: ResultLine[];
  byPosition: ResultLine[];
  /** Bankroll + chips on the table over time. */
  series: Array<{ ts: number; total: number; reason: BankrollPoint['reason']; stakeId?: string }>;
}

const POSITION_ORDER = ['UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'BTN/SB', 'SB', 'BB'];

/** Did you voluntarily put money in, and did you raise, before the flop? */
export function heroPreflop(rec: HandRecord): { vpip: boolean; pfr: boolean } {
  let vpip = false, pfr = false;
  for (const e of rec.hand.events) {
    if (e.type !== 'bet' || e.seat !== rec.heroSeat || e.street !== 'preflop') continue;
    const b = e as BetEvent;
    if (b.action === 'call' || b.action === 'raise' || b.action === 'bet') vpip = true;
    if (b.action === 'raise') pfr = true;
  }
  return { vpip, pfr };
}

interface Acc { hands: number; net: number; netBB: number; vpip: number; pfr: number; sessions: Set<string> }
const acc = (): Acc => ({ hands: 0, net: 0, netBB: 0, vpip: 0, pfr: 0, sessions: new Set() });

function line(key: string, label: string, a: Acc, withSessions: boolean): ResultLine {
  return {
    key, label,
    hands: a.hands,
    sessions: withSessions ? a.sessions.size : undefined,
    net: a.net,
    bbPer100: a.hands ? (a.netBB / a.hands) * 100 : 0,
    vpip: a.hands ? a.vpip / a.hands : null,
    pfr: a.hands ? a.pfr / a.hands : null,
  };
}

export function computeStats(hands: HandRecord[], sessions: SessionRow[], points: BankrollPoint[]): StatsSummary {
  const all = acc();
  const byStake = new Map<string, Acc>();
  const byPos = new Map<string, Acc>();
  for (const r of hands) {
    const hero = r.hand.players.find((p) => p.seat === r.heroSeat);
    if (!hero) continue;
    const { vpip, pfr } = heroPreflop(r);
    const bb = r.hand.config.bigBlind;
    for (const a of [all, getOr(byStake, r.stakeId), getOr(byPos, hero.position)]) {
      a.hands++;
      a.net += r.heroNet;
      a.netBB += r.heroNet / bb;
      if (vpip) a.vpip++;
      if (pfr) a.pfr++;
      a.sessions.add(r.sessionId);
    }
  }
  const sessionsByStake = new Map<string, number>();
  for (const s of sessions) sessionsByStake.set(s.stakeId, (sessionsByStake.get(s.stakeId) ?? 0) + 1);

  const stakeLines = STAKES.filter((s) => byStake.has(s.id) || sessionsByStake.has(s.id)).map((s) => {
    const l = line(s.id, s.label, byStake.get(s.id) ?? acc(), true);
    return { ...l, sessions: Math.max(l.sessions ?? 0, sessionsByStake.get(s.id) ?? 0) };
  });
  const posLines = [...byPos.keys()]
    .sort((a, b) => POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b))
    .map((p) => line(p, p, byPos.get(p)!, false));

  const series = points
    .slice()
    .sort((a, b) => a.ts - b.ts || (a.id ?? 0) - (b.id ?? 0))
    .map((p) => ({ ts: p.ts, total: p.bankroll + p.onTable, reason: p.reason, stakeId: p.stakeId }));

  return {
    hands: all.hands,
    sessions: sessions.length,
    handsNet: all.net,
    vpip: all.hands ? all.vpip / all.hands : null,
    pfr: all.hands ? all.pfr / all.hands : null,
    byStake: stakeLines,
    byPosition: posLines,
    series,
  };
}

function getOr(m: Map<string, Acc>, k: string): Acc {
  let a = m.get(k);
  if (!a) m.set(k, (a = acc()));
  return a;
}
