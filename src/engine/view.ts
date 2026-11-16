import type { Card } from './cards';
import { currentPots, legalActions, potTotal } from './hand';
import type { Position } from './positions';
import type { HandEvent, HandState, LegalActions, Phase } from './types';

/**
 * The information firewall between the engine and the players.
 *
 * Computer players only ever receive a PlayerView: their own hole cards, the
 * board, the public betting history, stacks and positions. Other players' hole
 * cards and the deck are not in it, so the AI cannot peek.
 */
export interface PublicPlayer {
  seat: number;
  id: string;
  name: string;
  position: Position;
  startStack: number;
  stack: number;
  committed: number;
  totalCommitted: number;
  folded: boolean;
  allIn: boolean;
  /** Cards this player showed at showdown, if any (public information). */
  shownCards: Card[] | null;
}

export interface PlayerView {
  handId: string;
  seat: number;
  hole: Card[];
  board: Card[];
  phase: Phase;
  smallBlind: number;
  bigBlind: number;
  buttonSeat: number;
  sbSeat: number | null;
  bbSeat: number;
  straddleSeat: number | null;
  players: PublicPlayer[];
  pot: number;
  pots: { amount: number; eligible: number[] }[];
  currentBet: number;
  minRaise: number;
  toAct: number | null;
  /** Legal options when it is this player's turn, otherwise null. */
  legal: LegalActions | null;
  /** Public events: posts, actions, board cards, shown hands, awards. */
  events: HandEvent[];
}

export function getPlayerView(s: HandState, seat: number): PlayerView {
  const me = s.players.find((p) => p.seat === seat);
  if (!me) throw new Error(`Seat ${seat} is not in this hand`);
  const shown = new Map<number, Card[]>();
  for (const e of s.events) if (e.type === 'show') shown.set(e.seat, e.cards.slice());
  return {
    handId: s.config.handId,
    seat,
    hole: me.hole.slice(),
    board: s.board.slice(),
    phase: s.phase,
    smallBlind: s.config.smallBlind,
    bigBlind: s.config.bigBlind,
    buttonSeat: s.config.buttonSeat,
    sbSeat: s.config.sbSeat,
    bbSeat: s.config.bbSeat,
    straddleSeat: s.config.straddleSeat ?? null,
    players: s.players.map((p) => ({
      seat: p.seat,
      id: p.id,
      name: p.name,
      position: p.position,
      startStack: p.startStack,
      stack: p.stack,
      committed: p.committed,
      totalCommitted: p.totalCommitted,
      folded: p.folded,
      allIn: p.allIn,
      shownCards: shown.get(p.seat) ?? null,
    })),
    pot: potTotal(s),
    pots: currentPots(s).map((p) => ({ amount: p.amount, eligible: p.eligible.slice() })),
    currentBet: s.currentBet,
    minRaise: s.minRaise,
    toAct: s.toAct,
    legal: s.toAct === seat ? legalActions(s) : null,
    events: s.events.map((e) => ({ ...e })),
  };
}
