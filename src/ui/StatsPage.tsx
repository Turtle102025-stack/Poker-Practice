import { useEffect, useState } from 'react';
import { START_BANKROLL, type StoreSnapshot } from '../app/gameStore';
import { computeStats, type ResultLine, type StatsSummary } from '../app/stats';
import { getDb, type SessionRow } from '../storage/db';
import { stakeById } from '../table/stakes';
import { LineChart, type LinePoint } from './components/LineChart';
import { money, signedMoney } from './format';

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
const REASON: Record<string, string> = {
  start: 'Starting bankroll',
  buyin: 'Sat down',
  addchips: 'Added chips',
  hand: 'After a hand',
  cashout: 'Left the table',
  reset: 'Bankroll reset to $2,000',
};

/** Your results: bankroll over time, results by table and position, VPIP and PFR. */
export default function StatsPage({ snap }: { snap: StoreSnapshot }) {
  const [data, setData] = useState<{ stats: StatsSummary; sessions: SessionRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const db = getDb();
    Promise.all([db.hands.toArray(), db.sessions.orderBy('startedAt').toArray(), db.bankroll.toArray()])
      .then(([hands, sessions, points]) => setData({ stats: computeStats(hands, sessions, points), sessions }))
      .catch((e) => setError((e as Error).message));
  }, []);

  const back = snap.table ? { href: '#/table', label: '← Back to the table' } : { href: '#/', label: '← Lobby' };
  const onTable = snap.table ? snap.table.ctl.heroStack() : 0;
  const total = snap.profile.bankroll + onTable;
  const deposited = START_BANKROLL * (1 + snap.profile.resets);
  const overall = total - deposited;

  if (error) return <div className="page"><a className="link" href={back.href}>{back.label}</a><p className="error">{error}</p></div>;
  if (!data) return <div className="page muted">Loading your stats…</div>;
  const { stats, sessions } = data;

  const points: LinePoint[] = stats.series.map((p) => ({
    ts: p.ts,
    value: p.total,
    note: `${REASON[p.reason] ?? p.reason}${p.stakeId ? ` · ${stakeById(p.stakeId).label}` : ''}`,
  }));
  const hi = points.length ? Math.max(...points.map((p) => p.value)) : 0;
  const lo = points.length ? Math.min(...points.map((p) => p.value)) : 0;

  return (
    <div className="page stats-page">
      <a className="link" href={back.href}>{back.label}</a>
      <h1>Your stats</h1>

      <div className="tiles">
        <Tile label="Bankroll now" value={money(total)} sub={onTable ? `${money(onTable)} on the table` : 'All off the table'} />
        <Tile label="Result since you started" value={signedMoney(overall)} tone={overall >= 0 ? 'pos' : 'neg'}
          sub={snap.profile.resets ? `After ${snap.profile.resets} reset${snap.profile.resets > 1 ? 's' : ''}` : `From ${money(START_BANKROLL)}`} />
        <Tile label="Hands played" value={stats.hands.toLocaleString()} sub={`${stats.sessions} session${stats.sessions === 1 ? '' : 's'}`} />
        <Tile label="VPIP" value={pct(stats.vpip)} sub="Put money in preflop" />
        <Tile label="PFR" value={pct(stats.pfr)} sub="Raised preflop" />
      </div>

      <section className="panel-box">
        <div className="row between wrap">
          <div>
            <h2>Bankroll over time</h2>
            <div className="muted small">Bankroll plus chips on the table, after every hand you play</div>
          </div>
          {points.length > 1 && <button onClick={() => setShowTable(!showTable)}>{showTable ? 'Show chart' : 'Show as table'}</button>}
        </div>
        {points.length <= 1 ? (
          <p className="muted">Play some hands and your bankroll line will appear here.</p>
        ) : showTable ? (
          <div className="scroll-table">
            <table className="data-table">
              <thead><tr><th>When</th><th>What</th><th className="num">Bankroll + table</th></tr></thead>
              <tbody>
                {points.slice(-300).reverse().map((p, i) => (
                  <tr key={i}><td>{new Date(p.ts).toLocaleString()}</td><td>{p.note}</td><td className="num">{money(p.value)}</td></tr>
                ))}
              </tbody>
            </table>
            {points.length > 300 && <p className="muted small">Showing the latest 300 of {points.length.toLocaleString()} points.</p>}
          </div>
        ) : (
          <LineChart
            points={points}
            reference={{ value: START_BANKROLL, label: `Start ${money(START_BANKROLL)}` }}
            format={(v) => money(Math.round(v))}
            ariaLabel={`Bankroll over time: from ${money(points[0].value)} to ${money(points[points.length - 1].value)}; high ${money(hi)}, low ${money(lo)}. Use the arrow keys to read values.`}
          />
        )}
      </section>

      <section className="panel-box">
        <h2>Results by table</h2>
        <ResultsTable lines={stats.byStake} firstHeader="Table" showSessions />
      </section>

      <section className="panel-box">
        <h2>Results by position</h2>
        <p className="muted small">All tables combined; bb/100 uses each hand's own big blind.</p>
        <ResultsTable lines={stats.byPosition} firstHeader="Position" />
      </section>

      <section className="panel-box">
        <h2>Sessions</h2>
        {sessions.length === 0 ? <p className="muted">No sessions yet.</p> : (
          <div className="scroll-table">
            <table className="data-table">
              <thead><tr><th>Started</th><th>Table</th><th className="num">Hands</th><th className="num">Bought in</th><th className="num">Cashed out</th><th className="num">Result</th></tr></thead>
              <tbody>
                {sessions.slice().reverse().map((s) => {
                  const live = s.cashedOut === null;
                  const result = live ? null : (s.cashedOut ?? 0) - s.boughtIn;
                  return (
                    <tr key={s.id}>
                      <td>{new Date(s.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                      <td>{stakeById(s.stakeId).label}</td>
                      <td className="num">{s.hands}</td>
                      <td className="num">{money(s.boughtIn)}</td>
                      <td className="num">{live ? 'playing' : money(s.cashedOut ?? 0)}</td>
                      <td className={`num ${result === null ? '' : result >= 0 ? 'pos' : 'neg'}`}>{result === null ? '–' : signedMoney(result)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className={`tile-value ${tone ?? ''}`}>{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

function ResultsTable({ lines, firstHeader, showSessions }: { lines: ResultLine[]; firstHeader: string; showSessions?: boolean }) {
  if (lines.length === 0) return <p className="muted">No hands yet.</p>;
  return (
    <div className="scroll-table">
      <table className="data-table">
        <thead>
          <tr>
            <th>{firstHeader}</th>
            {showSessions && <th className="num">Sessions</th>}
            <th className="num">Hands</th>
            <th className="num">Result</th>
            <th className="num" title="Big blinds won per 100 hands">bb/100</th>
            <th className="num">VPIP</th>
            <th className="num">PFR</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key}>
              <td>{l.label}</td>
              {showSessions && <td className="num">{l.sessions}</td>}
              <td className="num">{l.hands.toLocaleString()}</td>
              <td className={`num ${l.net >= 0 ? 'pos' : 'neg'}`}>{signedMoney(l.net)}</td>
              <td className={`num ${l.bbPer100 >= 0 ? 'pos' : 'neg'}`}>{l.hands ? `${l.bbPer100 >= 0 ? '+' : '−'}${Math.abs(l.bbPer100).toFixed(1)}` : '–'}</td>
              <td className="num">{pct(l.vpip)}</td>
              <td className="num">{pct(l.pfr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
