import { parseCards, type Card } from './cards';
import { orderedDeck } from './deck';
import { applyAction, dealOrder, startHand } from './hand';
import type { HandConfig, HandState, PlayerAction, RakeConfig } from './types';

/**
 * Test helpers: build a hand with exact hole cards and board, and apply a
 * sequence of actions using short codes.
 */

export interface MakeHandOptions {
  stacks: Record<number, number>;
  button: number;
  sb: number | null;
  bb: number;
  blinds?: [number, number];
  holes?: Record<number, string>;
  board?: string;
  straddle?: number | null;
  livePosters?: number[];
  rake?: RakeConfig;
  numSeats?: number;
}

export function deckFor(config: HandConfig, holes: Record<number, string> = {}, board = ''): Card[] {
  const holeCards = new Map<number, Card[]>();
  for (const [seat, text] of Object.entries(holes)) holeCards.set(Number(seat), parseCards(text));
  const boardCards = board ? parseCards(board) : [];
  const used = new Set<Card>([...boardCards, ...[...holeCards.values()].flat()]);
  if (used.size !== boardCards.length + [...holeCards.values()].flat().length) {
    throw new Error('Duplicate card in test setup');
  }
  const pool = orderedDeck().filter((c) => !used.has(c));
  const deck: Card[] = [];
  for (const step of dealOrder(config)) {
    if (step.kind === 'hole') {
      const mine = holeCards.get(step.seat);
      deck.push(mine && mine.length ? mine.shift()! : pool.shift()!);
    } else if (step.kind === 'burn') {
      deck.push(pool.shift()!);
    } else {
      deck.push(boardCards.length ? boardCards.shift()! : pool.shift()!);
    }
  }
  return [...deck, ...pool];
}

export function makeHand(o: MakeHandOptions): HandState {
  const [sbAmt, bbAmt] = o.blinds ?? [1, 3];
  const config: HandConfig = {
    handId: 'test',
    numSeats: o.numSeats ?? 10,
    smallBlind: sbAmt,
    bigBlind: bbAmt,
    players: Object.entries(o.stacks).map(([seat, stack]) => ({
      seat: Number(seat),
      id: `s${seat}`,
      name: `P${seat}`,
      stack,
    })),
    buttonSeat: o.button,
    sbSeat: o.sb,
    bbSeat: o.bb,
    livePosters: o.livePosters,
    straddleSeat: o.straddle ?? null,
    rake: o.rake,
  };
  return startHand(config, deckFor(config, o.holes, o.board));
}

/**
 * Parses an action code: f = fold, x = check, c = call, a = all-in,
 * b40 = bet to 40, r120 = raise to 120.
 */
export function parseAction(code: string): PlayerAction {
  const c = code.trim();
  if (c === 'f') return { type: 'fold' };
  if (c === 'x') return { type: 'check' };
  if (c === 'c') return { type: 'call' };
  if (c === 'a') return { type: 'allin' };
  const m = /^([br])(\d+)$/.exec(c);
  if (m) return { type: m[1] === 'b' ? 'bet' : 'raise', to: Number(m[2]) };
  throw new Error(`Bad action code ${code}`);
}

/** Applies actions in turn order. Each code applies to whoever is next to act. */
export function act(s: HandState, ...codes: string[]): HandState {
  let cur = s;
  for (const code of codes) {
    if (cur.toAct === null) throw new Error(`No one to act for "${code}"`);
    cur = applyAction(cur, cur.toAct, parseAction(code));
  }
  return cur;
}

export function stackOf(s: HandState, seat: number): number {
  return s.players.find((p) => p.seat === seat)!.stack;
}
