import { useMemo, useState } from 'react';
import { ARCHETYPE_LABELS } from '../ai/archetypes';
import { emptyCounts, summarize } from '../ai/publicStats';
import { ROSTER } from '../ai/roster';
import type { GameStore, StoreSnapshot } from '../app/gameStore';
import { PlayerPanel } from './table/PlayerPanel';

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);

/** Everyone you've played with, your reads on them, and (if you ask) their true styles. */
export default function PlayersPage({ store, snap, reveal: revealInitially }: { store: GameStore; snap: StoreSnapshot; reveal: boolean }) {
  const [reveal, setReveal] = useState(revealInitially);
  const [showAll, setShowAll] = useState(revealInitially);
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    return ROSTER.map((p) => {
      const stats = summarize(snap.observed[p.id] ?? emptyCounts());
      const note = snap.notes[p.id];
      const label = note?.label && note.label !== 'Unknown' ? note.label : null;
      return { p, stats, note, label, truth: ARCHETYPE_LABELS[p.archetype] };
    }).sort((a, b) => b.stats.hands - a.stats.hands || a.p.name.localeCompare(b.p.name));
  }, [snap.observed, snap.notes]);

  const met = rows.filter((r) => r.stats.hands > 0 || r.note);
  const visible = showAll ? rows : met;
  const labeled = rows.filter((r) => r.label);
  const correct = labeled.filter((r) => r.label === r.truth).length;
  const back = snap.table ? { href: '#/table', label: '← Back to the table' } : { href: '#/', label: '← Lobby' };
  const openRow = open ? rows.find((r) => r.p.id === open) : null;

  return (
    <div className="page players-page">
      <a className="link" href={back.href}>{back.label}</a>
      <h1>Players &amp; your reads</h1>
      <p className="muted">
        Tag players with a label and notes from here or by clicking them at the table. Stats are everything you've
        observed in hands you've played with them.
      </p>

      <div className="row wrap">
        <button className={reveal ? 'on' : ''} onClick={() => setReveal(!reveal)}>
          {reveal ? '🙈 Hide styles' : '🔍 Reveal styles'}
        </button>
        <button className={showAll ? 'on' : ''} onClick={() => setShowAll(!showAll)}>
          {showAll ? `Showing all ${rows.length} players` : `Showing ${met.length} you've met`}
        </button>
      </div>

      {reveal && (
        <section className="panel-box scorecard">
          {labeled.length === 0 ? (
            <p>You haven't labeled anyone yet. Click a player to give them a label, then come back to check your reads.</p>
          ) : (
            <p>
              Your reads: <b>{correct}</b> of <b>{labeled.length}</b> labeled players correct
              ({Math.round((correct / labeled.length) * 100)}%).
            </p>
          )}
        </section>
      )}

      {visible.length === 0 && <p className="muted">You haven't played with anyone yet.</p>}
      <div className="player-list">
        <div className="pl-row pl-head">
          <span>Player</span><span className="num">Hands</span><span className="num">VPIP</span><span className="num">PFR</span>
          <span>Your label</span>{reveal && <span>True style</span>}<span>Notes</span>
        </div>
        {visible.map((r) => (
          <button key={r.p.id} className="pl-row" onClick={() => setOpen(r.p.id)}>
            <span className="pl-name">{r.p.name}</span>
            <span className="num">{r.stats.hands}</span>
            <span className="num">{pct(r.stats.vpip)}</span>
            <span className="num">{pct(r.stats.pfr)}</span>
            <span className="pl-label">{r.label ? <span className="label-pill">{r.label}</span> : <span className="muted">–</span>}</span>
            {reveal && (
              <span className={`pl-truth ${r.label ? (r.label === r.truth ? 'pos' : 'neg') : ''}`}>
                {r.truth} {r.label ? (r.label === r.truth ? '✓' : '✗') : ''}
              </span>
            )}
            <span className="pl-notes muted">{r.note?.text ?? ''}</span>
          </button>
        ))}
      </div>

      {openRow && (
        <PlayerPanel
          playerId={openRow.p.id}
          name={openRow.p.name}
          allTime={openRow.stats}
          note={openRow.note}
          onSaveNote={(patch) => void store.setNote(openRow.p.id, patch)}
          revealStyle={reveal}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
