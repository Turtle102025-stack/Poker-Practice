import { useEffect, useMemo, useState } from 'react';
import type { StoreSnapshot } from '../app/gameStore';
import { cardsToString } from '../engine/cards';
import { copyText, downloadFile, toCsv, toXlsx } from '../history/files';
import { toPokerStars, toPokerStarsFile } from '../history/pokerstars';
import type { HandRecord } from '../history/record';
import { buildSheets } from '../history/sheets';
import { getDb } from '../storage/db';
import { queryHands, summarizeHands, type HandQuery } from '../storage/handsRepo';
import { CardView } from './components/CardView';
import { money, signedMoney } from './format';

type RangeKind = 'session' | 'today' | 'week' | 'all' | 'custom';
const PAGE = 40;

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function inputDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseInputDate(s: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : undefined;
}

export interface HistoryOptions {
  /** Your label for a player, if you've tagged them (Phase 6). */
  labelFor?: (playerId: string) => string | undefined;
}

/** Your saved hands: browse, copy as text, and export. */
export default function HistoryPage({ snap, labelFor }: { snap: StoreSnapshot } & HistoryOptions) {
  const [latestSession, setLatestSession] = useState<string | null>(snap.table?.sessionId ?? snap.lastSession?.sessionId ?? null);
  useEffect(() => {
    if (latestSession) return;
    void getDb().sessions.orderBy('startedAt').last().then((s) => s && setLatestSession(s.id)).catch(() => {});
  }, [latestSession]);

  const [kind, setKind] = useState<RangeKind>(latestSession ? 'session' : 'today');
  const [from, setFrom] = useState(inputDate(Date.now() - 6 * 86_400_000));
  const [to, setTo] = useState(inputDate(Date.now()));
  const [includeStyles, setIncludeStyles] = useState(false);
  const [allHoleCards, setAllHoleCards] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const query: HandQuery | null = useMemo(() => {
    const now = new Date();
    switch (kind) {
      case 'session': return latestSession ? { sessionId: latestSession } : null;
      case 'today': return { from: dayStart(now) };
      case 'week': return { from: dayStart(now) - 6 * 86_400_000 };
      case 'all': return {};
      case 'custom': {
        const f = parseInputDate(from), t = parseInputDate(to);
        return f === undefined || t === undefined ? null : { from: f, to: t + 86_400_000 };
      }
    }
  }, [kind, from, to, latestSession]);

  const [summary, setSummary] = useState<{ count: number; net: number } | null>(null);
  const [hands, setHands] = useState<HandRecord[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    setShown(PAGE);
    setOpen(null);
    if (!query) {
      setSummary({ count: 0, net: 0 });
      setHands([]);
      return;
    }
    let live = true;
    void summarizeHands(query).then((s) => live && setSummary(s));
    void queryHands(query, { limit: PAGE, newestFirst: true }).then((h) => live && setHands(h));
    return () => {
      live = false;
    };
  }, [query]);

  const loadMore = async () => {
    if (!query) return;
    const more = await queryHands(query, { limit: PAGE, offset: shown, newestFirst: true });
    setHands((h) => [...h, ...more]);
    setShown((n) => n + PAGE);
  };

  const fileStem = () => {
    const today = inputDate(Date.now());
    const label = kind === 'custom' ? `${from}-to-${to}` : kind === 'session' ? 'session' : kind;
    return `poker-hands-${label}-${today}`;
  };

  const exportAs = async (format: 'xlsx' | 'csv' | 'txt') => {
    if (!query) return;
    setBusy(format);
    setMessage(null);
    try {
      const records = await queryHands(query);
      if (records.length === 0) {
        setMessage('No hands in this range yet.');
        return;
      }
      if (format === 'txt') {
        downloadFile(`${fileStem()}.txt`, toPokerStarsFile(records, { allHoleCards }), 'text/plain;charset=utf-8');
      } else {
        const sheets = buildSheets(records, { includeStyles, labelFor });
        if (format === 'xlsx') {
          const buf = await toXlsx(sheets);
          downloadFile(`${fileStem()}.xlsx`, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        } else {
          for (const sh of sheets) {
            downloadFile(`${fileStem()}-${sh.name.toLowerCase()}.csv`, '﻿' + toCsv(sh), 'text/csv;charset=utf-8');
            await new Promise((r) => setTimeout(r, 400));
          }
        }
      }
      setMessage(`Exported ${records.length.toLocaleString()} hand${records.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setMessage(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const back = snap.table ? { href: '#/table', label: '← Back to the table' } : { href: '#/', label: '← Lobby' };
  const ranges: Array<[RangeKind, string]> = [
    ...(latestSession ? [['session', snap.table ? 'This session' : 'Last session'] as [RangeKind, string]] : []),
    ['today', 'Today'],
    ['week', 'Last 7 days'],
    ['all', 'All hands'],
    ['custom', 'Dates…'],
  ];

  return (
    <div className="page history">
      <a className="link" href={back.href}>{back.label}</a>
      <h1>Hand history</h1>

      <section className="panel-box">
        <div className="seg">
          {ranges.map(([k, l]) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        {kind === 'custom' && (
          <div className="row wrap dates">
            <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
        )}
        <p className="summary-line">
          {summary ? (
            <>
              <b>{summary.count.toLocaleString()}</b> hand{summary.count === 1 ? '' : 's'} · your result{' '}
              <b className={summary.net >= 0 ? 'pos' : 'neg'}>{signedMoney(summary.net)}</b>
            </>
          ) : 'Counting…'}
        </p>
      </section>

      <section className="panel-box">
        <h2>Export</h2>
        <p className="muted small">
          The spreadsheet has three sheets — Hands (one row per hand), Actions (every post, fold, check, call, bet and
          raise with sizes, pot and stacks) and Players (one row per player per hand) — plus a Notes sheet explaining
          each column. Upload it to Claude for a review. The text file uses the PokerStars hand history format.
        </p>
        <div className="row wrap">
          <button className="act raise" disabled={!!busy || !summary?.count} onClick={() => void exportAs('xlsx')}>
            {busy === 'xlsx' ? 'Building…' : 'Download .xlsx'}
          </button>
          <button disabled={!!busy || !summary?.count} onClick={() => void exportAs('csv')}>
            {busy === 'csv' ? 'Building…' : 'Download CSV (3 files)'}
          </button>
          <button disabled={!!busy || !summary?.count} onClick={() => void exportAs('txt')}>
            {busy === 'txt' ? 'Building…' : 'Download text (.txt)'}
          </button>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={includeStyles} onChange={(e) => setIncludeStyles(e.target.checked)} />
          <span>Include each player's true style (spreadsheet)<small>Leave off if you want Claude to judge players only from their play.</small></span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={allHoleCards} onChange={(e) => setAllHoleCards(e.target.checked)} />
          <span>Show everyone's hole cards in text histories (practice-mode hands)<small>Turn off for strict imports into tracking software.</small></span>
        </label>
        {message && <p className="note">{message}</p>}
      </section>

      <section>
        <h2>Hands</h2>
        {hands.length === 0 && <p className="muted">No hands here yet. Hands you play are saved automatically.</p>}
        <div className="hand-list">
          {hands.map((h) => (
            <HandItem key={h.id} rec={h} open={open === h.id} allHoleCards={allHoleCards} onToggle={() => setOpen(open === h.id ? null : h.id)} />
          ))}
        </div>
        {summary && hands.length < summary.count && (
          <button onClick={() => void loadMore()}>Show more ({(summary.count - hands.length).toLocaleString()} older)</button>
        )}
      </section>
    </div>
  );
}

function HandItem({ rec, open, allHoleCards, onToggle }: { rec: HandRecord; open: boolean; allHoleCards: boolean; onToggle: () => void }) {
  const [copied, setCopied] = useState(false);
  const hero = rec.hand.players.find((p) => p.seat === rec.heroSeat);
  const time = new Date(rec.startedAt);
  const text = open ? toPokerStars(rec, { allHoleCards }) : '';
  return (
    <div className={`hand-item ${open ? 'open' : ''}`}>
      <button className="hand-summary" onClick={onToggle} aria-expanded={open}>
        <span className="hi-time">{time.toLocaleDateString()} {time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        <span className="hi-stakes">{rec.stakesLabel}</span>
        <span className="hi-pos">{hero?.position}</span>
        <span className="hi-cards">{hero?.hole.map((c, i) => <CardView key={i} card={c} size="sm" />)}</span>
        <span className="hi-board muted">{rec.hand.board.length ? cardsToString(rec.hand.board) : 'no flop'}</span>
        <span className={`hi-net ${rec.heroNet > 0 ? 'pos' : rec.heroNet < 0 ? 'neg' : ''}`}>{rec.heroNet === 0 ? money(0) : signedMoney(rec.heroNet)}</span>
      </button>
      {open && (
        <div className="hand-detail">
          <div className="row wrap">
            <button
              className="act raise"
              onClick={async () => {
                setCopied(await copyText(text));
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied ✓' : 'Copy hand history'}
            </button>
            <span className="muted small">Hand #{rec.id} · paste it into a chat with Claude</span>
          </div>
          <pre className="hh-text">{text}</pre>
        </div>
      )}
    </div>
  );
}
