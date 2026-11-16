import { ARCHETYPE_LABELS, ARCHETYPE_SUMMARIES } from '../../ai/archetypes';
import type { ObservedStats } from '../../ai/publicStats';
import { ROSTER_BY_ID } from '../../ai/roster';
import type { PlayerNote, ReadLabel } from '../../storage/db';
import { ReadEditor } from '../components/ReadEditor';
import { money } from '../format';

interface Props {
  playerId: string;
  name: string;
  seat?: number;
  stack?: number;
  session?: ObservedStats;
  allTime: ObservedStats;
  note?: PlayerNote;
  onSaveNote?: (patch: { label?: ReadLabel; text?: string }) => void;
  revealStyle: boolean;
  tilted?: boolean;
  onClose: () => void;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);
const af = (x: number | null | undefined) => (x === null || x === undefined ? '–' : x.toFixed(1));

/** What you know about a player: what you can see, your read, and what you've observed. */
export function PlayerPanel({ playerId, name, seat, stack, session, allTime, note, onSaveNote, revealStyle, tilted, onClose }: Props) {
  const player = ROSTER_BY_ID.get(playerId);
  const isHero = playerId === 'hero';
  const trueLabel = player ? ARCHETYPE_LABELS[player.archetype] : null;
  const myLabel = note?.label && note.label !== 'Unknown' ? note.label : null;
  const rows: Array<[string, string, (s: ObservedStats) => string]> = [
    ['Hands seen', 'Hands you were both dealt into', (s) => String(s.hands)],
    ['VPIP', 'Voluntarily put money in preflop', (s) => pct(s.vpip)],
    ['PFR', 'Raised preflop', (s) => pct(s.pfr)],
    ['Limped', 'Called the big blind first in', (s) => pct(s.limp)],
    ['3-bet', 'Re-raised when facing one raise', (s) => pct(s.threeBet)],
    ['C-bet', 'Bet the flop after raising preflop', (s) => pct(s.cbet)],
    ['Fold to c-bet', 'Folded to a flop continuation bet', (s) => pct(s.foldToCbet)],
    ['Showdown', 'Went to showdown after seeing the flop', (s) => pct(s.wtsd)],
    ['Aggression', '(Bets + raises) ÷ calls after the flop', (s) => af(s.af)],
  ];
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings player-panel" role="dialog" aria-label={`About ${name}`} onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>{isHero ? 'You' : name}{myLabel && <span className="label-pill">{myLabel}</span>}</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        {seat !== undefined && <p className="muted">Seat {seat + 1}{stack !== undefined ? ` · stack ${money(stack)}` : ''}</p>}
        {player && <p className="desc">{player.description}</p>}
        {player && revealStyle && (
          <p className="reveal">
            <b>True style: {trueLabel}.</b> {ARCHETYPE_SUMMARIES[player.archetype]}
            {myLabel && <><br />Your read: {myLabel} {myLabel === trueLabel ? '✓ correct' : '✗ not quite'}</>}
            {tilted && <><br /><b>Currently on tilt.</b></>}
          </p>
        )}

        {!isHero && onSaveNote && (
          <>
            <h3>Your read</h3>
            <ReadEditor key={playerId} note={note} onSave={onSaveNote} />
          </>
        )}

        <h3>{isHero ? 'Your stats' : 'What you’ve observed'}</h3>
        <table className="stat-table">
          <thead>
            <tr><th /><th className="num">{session ? 'This session' : ''}</th><th className="num">All time</th></tr>
          </thead>
          <tbody>
            {rows.map(([label, title, f]) => (
              <tr key={label}>
                <td title={title}>{label}</td>
                <td className="num">{session ? f(session) : ''}</td>
                <td className="num">{f(allTime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {allTime.hands < 30 && <p className="muted small">Small sample: stats settle down after 50+ hands.</p>}
      </div>
    </div>
  );
}
