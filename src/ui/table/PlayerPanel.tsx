import { ARCHETYPE_LABELS, ARCHETYPE_SUMMARIES } from '../../ai/archetypes';
import type { ObservedStats } from '../../ai/publicStats';
import { ROSTER_BY_ID } from '../../ai/roster';
import type { Occupant } from '../../table/controller';
import { money } from '../format';

interface Props {
  occ: Occupant;
  stats: ObservedStats;
  revealStyle: boolean;
  tilted: boolean;
  onClose: () => void;
}

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);

/** What you know about a player: what you can see, and what you've observed. */
export function PlayerPanel({ occ, stats, revealStyle, tilted, onClose }: Props) {
  const player = ROSTER_BY_ID.get(occ.id);
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings player-panel" role="dialog" aria-label={`About ${occ.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>{occ.isHero ? 'You' : occ.name}</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="muted">Seat {occ.seat + 1} · stack {money(occ.stack)}</p>
        {player && <p className="desc">{player.description}</p>}
        {player && revealStyle && (
          <p className="reveal">
            <b>True style: {ARCHETYPE_LABELS[player.archetype]}.</b> {ARCHETYPE_SUMMARIES[player.archetype]}
            {tilted && <><br /><b>Currently on tilt.</b></>}
          </p>
        )}

        <h3>Observed this session</h3>
        <table className="stat-table">
          <tbody>
            <tr><td>Hands seen</td><td className="num">{stats.hands}</td></tr>
            <tr><td title="Voluntarily put money in the pot preflop">VPIP</td><td className="num">{pct(stats.vpip)}</td></tr>
            <tr><td title="Raised preflop">PFR</td><td className="num">{pct(stats.pfr)}</td></tr>
            <tr><td>Limped</td><td className="num">{pct(stats.limp)}</td></tr>
            <tr><td>3-bet</td><td className="num">{pct(stats.threeBet)}</td></tr>
            <tr><td>C-bet</td><td className="num">{pct(stats.cbet)}</td></tr>
            <tr><td>Fold to c-bet</td><td className="num">{pct(stats.foldToCbet)}</td></tr>
            <tr><td title="Went to showdown after seeing the flop">Showdown</td><td className="num">{pct(stats.wtsd)}</td></tr>
            <tr><td title="(Bets + raises) ÷ calls after the flop">Aggression</td><td className="num">{stats.af === null ? '–' : stats.af.toFixed(1)}</td></tr>
          </tbody>
        </table>
        {stats.hands < 30 && <p className="muted small">Small sample: stats settle down after 50+ hands.</p>}
        <p className="muted small">Your notes and labels for players arrive in Phase 6.</p>
      </div>
    </div>
  );
}
