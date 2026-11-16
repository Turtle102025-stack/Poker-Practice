import type { CSSProperties } from 'react';
import { ARCHETYPE_SHORT } from '../../ai/archetypes';
import { ROSTER_BY_ID } from '../../ai/roster';
import { bestFiveCards } from '../../engine/evaluator';
import { currentPots } from '../../engine/hand';
import type { BetEvent, HandState, PlayerState } from '../../engine/types';
import type { Occupant, TableSnapshot } from '../../table/controller';
import { CardView, EmptyCardSlot } from '../components/CardView';
import { money } from '../format';

interface Props {
  snap: TableSnapshot;
  onSeatClick?: (seat: number) => void;
  isTilted?: (playerId: string) => boolean;
  /** Your label for a player, if you've tagged them. */
  labelOf?: (playerId: string) => string | undefined;
  /** Join screen: the seat you picked, and a handler to pick an open seat. */
  pickSeat?: number | null;
  onPickSeat?: (seat: number) => void;
}

const POST_LABEL: Record<string, string> = { sb: 'SB', bb: 'BB', straddle: 'Straddle', 'live-bb': 'Post' };

/** Angle (degrees, screen coordinates) for a seat, with your seat at the bottom. */
function seatAngle(seat: number, heroSeat: number, numSeats: number): number {
  const v = (seat - heroSeat + numSeats) % numSeats;
  return 90 + (v * 360) / numSeats;
}

function trig(deg: number, prefix = ''): CSSProperties {
  const rad = (deg * Math.PI) / 180;
  return { [`--${prefix}cos`]: Math.cos(rad).toFixed(4), [`--${prefix}sin`]: Math.sin(rad).toFixed(4) } as CSSProperties;
}

/** The last thing a player did on the current street, for the label under their name. */
function lastActionLabel(hand: HandState, p: PlayerState): string | null {
  if (p.folded) return 'Fold';
  const street = hand.phase === 'complete' ? null : hand.phase;
  let last: BetEvent | null = null;
  for (const e of hand.events) if (e.type === 'bet' && e.seat === p.seat && e.street === street) last = e;
  if (!last) return null;
  if (last.allIn) return 'All-in';
  switch (last.action) {
    case 'post': return last.postKind === 'sb' || last.postKind === 'bb' ? null : POST_LABEL[last.postKind ?? 'bb'];
    case 'check': return 'Check';
    case 'call': return 'Call';
    case 'bet': return 'Bet';
    case 'raise': return 'Raise';
    default: return null;
  }
}

export function TableFelt({ snap, onSeatClick, isTilted, labelOf, pickSeat, onPickSeat }: Props) {
  const { hand, seats, heroSeat, table, settings } = snap;
  const n = table.numSeats;
  const done = hand?.phase === 'complete';

  const winnings = new Map<number, number>();
  const descriptions = new Map<number, string>();
  const shown = new Set<number>();
  if (hand) {
    for (const e of hand.events) {
      if (e.type === 'award') {
        winnings.set(e.seat, (winnings.get(e.seat) ?? 0) + e.amount);
        if (e.description) descriptions.set(e.seat, e.description);
      }
      if (e.type === 'show') shown.add(e.seat);
    }
  }
  // Highlight the winning five cards of the best hand shown.
  const highlightCards = new Set<number>();
  if (done && hand && hand.result?.wentToShowdown) {
    const topWinner = [...winnings.entries()].sort((a, b) => b[1] - a[1])[0];
    const w = topWinner && hand.players.find((p) => p.seat === topWinner[0]);
    if (w && shown.has(w.seat)) for (const c of bestFiveCards([...w.hole, ...hand.board])) highlightCards.add(c);
  }

  const pots = hand ? currentPots(hand) : [];
  const totalInMiddle = hand ? hand.players.reduce((a, p) => a + p.totalCommitted, 0) : 0;

  return (
    <div className="felt-wrap">
      <div className="felt" />
      <div className="center">
        {hand && !done && (
          <div className="pot-line">
            <span className="pot">Pot {money(totalInMiddle)}</span>
            {pots.length > 1 && (
              <span className="pot-total">
                {pots.map((p, i) => `${i === 0 ? 'Main' : `Side ${i}`} ${money(p.amount)}`).join(' · ')}
              </span>
            )}
          </div>
        )}
        {done && hand?.result && (
          <div className="results">
            {[...winnings.entries()].map(([seat, amt]) => {
              const who = seat === heroSeat ? 'You' : hand.players.find((p) => p.seat === seat)!.name;
              const d = descriptions.get(seat);
              return (
                <div key={seat} className="res">
                  {who} <b>{seat === heroSeat ? 'win' : 'wins'} {money(amt)}</b>{d ? ` with ${d}` : ''}
                </div>
              );
            })}
          </div>
        )}
        <div className="board">
          {[0, 1, 2, 3, 4].map((i) =>
            hand && hand.board[i] !== undefined ? (
              <CardView key={i} card={hand.board[i]} size="lg" fourColor={settings.fourColorDeck} highlight={highlightCards.has(hand.board[i])} />
            ) : (
              <EmptyCardSlot key={i} size="lg" />
            ),
          )}
        </div>
        <div className="table-name">{table.name}</div>
      </div>

      {hand && (
        <div className="dealer-btn" style={trig(seatAngle(hand.config.buttonSeat, heroSeat, n) - 14)} title="Dealer button">
          D
        </div>
      )}

      {seats.map((occ, seat) => {
        const angle = seatAngle(seat, heroSeat, n);
        const p = hand?.players.find((x) => x.seat === seat);
        return (
          <SeatView
            key={seat}
            seat={seat}
            style={trig(angle)}
            occ={occ}
            player={p}
            hand={hand}
            snap={snap}
            won={winnings.get(seat)}
            showCards={!!p && (seat === heroSeat || shown.has(seat) || (done && settings.practiceMode))}
            highlightCards={highlightCards}
            onClick={onSeatClick}
            picked={pickSeat === seat}
            myLabel={occ && !occ.isHero ? labelOf?.(occ.id) : undefined}
            onPick={onPickSeat}
            badge={
              snap.settings.revealStyles && occ && !occ.isHero && ROSTER_BY_ID.has(occ.id)
                ? ARCHETYPE_SHORT[ROSTER_BY_ID.get(occ.id)!.archetype] + (isTilted?.(occ.id) ? ' · tilt' : '')
                : undefined
            }
          />
        );
      })}

      {hand && !done &&
        hand.players
          .filter((p) => p.committed > 0)
          .map((p) => (
            <div key={p.seat} className="bet" style={trig(seatAngle(p.seat, heroSeat, n))}>
              <span className="chip" />
              {money(p.committed)}
            </div>
          ))}
    </div>
  );
}

interface SeatProps {
  seat: number;
  style: CSSProperties;
  occ: Occupant | null;
  player: PlayerState | undefined;
  hand: HandState | null;
  snap: TableSnapshot;
  won?: number;
  showCards: boolean;
  highlightCards: Set<number>;
  onClick?: (seat: number) => void;
  badge?: string;
  myLabel?: string;
  picked?: boolean;
  onPick?: (seat: number) => void;
}

function SeatView({ seat, style, occ, player, hand, snap, won, showCards, highlightCards, onClick, badge, myLabel, picked, onPick }: SeatProps) {
  if (!occ && onPick) {
    return (
      <div className={`seat empty pick ${picked ? 'picked' : ''}`} style={style}>
        <button className="plate" onClick={() => onPick(seat)}>{picked ? 'Your seat' : 'Sit here'}<br />Seat {seat + 1}</button>
      </div>
    );
  }
  if (!occ) {
    return (
      <div className="seat empty" style={style}>
        <div className="plate">Seat {seat + 1}<br />open</div>
      </div>
    );
  }
  const done = hand?.phase === 'complete';
  const isHero = occ.isHero;
  const acting = !!hand && !done && hand.toAct === seat;
  const label = player && hand ? lastActionLabel(hand, player) : null;
  const stack = player ? player.stack : occ.stack;
  const cls = [
    'seat',
    isHero ? 'hero' : '',
    acting ? 'acting' : '',
    player?.folded ? 'folded' : '',
    !player ? 'out' : '',
    done && won ? 'winner' : '',
    showCards && player?.folded ? 'reveal' : '',
  ].filter(Boolean).join(' ');

  const tagClass = label === 'Fold' ? 'fold' : label === 'All-in' ? 'allin' : '';
  return (
    <div className={cls} style={style} onClick={() => onClick?.(seat)}>
      <div className="hole">
        {player && player.hole.map((c, i) => (
          <CardView
            key={i}
            card={showCards ? c : null}
            size={isHero ? 'md' : 'sm'}
            fourColor={snap.settings.fourColorDeck}
            dim={player.folded && showCards && !isHero}
            highlight={highlightCards.has(c) && showCards}
          />
        ))}
      </div>
      <div className="plate">
        <div className="name">{isHero ? 'You' : occ.name}</div>
        <div className="stack">{money(stack)}</div>
        <div className="foot">
          {player ? (
            <span className="pos">{player.position}</span>
          ) : occ.status !== 'active' ? (
            <span className="pos">{occ.status === 'postToEnter' ? 'Posting in' : 'Waiting for BB'}</span>
          ) : hand ? (
            <span className="pos">Sitting out</span>
          ) : null}
          {done && won ? (
            <span className="tag win">+{money(won)}</span>
          ) : label && !done ? (
            <span className={`tag ${tagClass}`}>{label}</span>
          ) : null}
        </div>
        {myLabel && myLabel !== 'Unknown' && <div className="badge mine" title="Your label">{myLabel}</div>}
        {badge && <div className="badge">{badge}</div>}
        {acting && <div className="think" key={`${hand?.events.length}`} />}
      </div>
    </div>
  );
}
