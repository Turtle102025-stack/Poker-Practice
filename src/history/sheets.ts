import { ARCHETYPE_LABELS } from '../ai/archetypes';
import { ROSTER_BY_ID } from '../ai/roster';
import { cardsToString } from '../engine/cards';
import type { BetEvent } from '../engine/types';
import { HERO_NAME, playerName, type HandRecord } from './record';

/**
 * The three export sheets (Hands, Actions, Players) as plain rows, used for
 * both the .xlsx and the CSV files.
 */
export type ColType = 'text' | 'int' | 'money' | 'bb' | 'pct' | 'datetime' | 'yesno';

export interface Column {
  key: string;
  header: string;
  type: ColType;
  width: number;
}

export type Row = Record<string, string | number | boolean | Date | null>;

export interface Sheet {
  name: string;
  columns: Column[];
  rows: Row[];
}

export interface SheetOptions {
  /** Add each computer player's true style. */
  includeStyles: boolean;
  /** Your label for a player (from your notes), by player id. */
  labelFor?: (playerId: string) => string | undefined;
}

const col = (key: string, header: string, type: ColType, width = 12): Column => ({ key, header, type, width });

export const HAND_COLUMNS: Column[] = [
  col('handId', 'Hand ID', 'int', 15),
  col('time', 'Date & time', 'datetime', 19),
  col('table', 'Table', 'text', 24),
  col('stakes', 'Stakes', 'text', 9),
  col('players', 'Players', 'int', 8),
  col('buttonSeat', 'Button seat', 'int', 8),
  col('mySeat', 'My seat', 'int', 8),
  col('myPosition', 'My position', 'text', 9),
  col('myCards', 'My cards', 'text', 9),
  col('myStartStack', 'My starting stack', 'money', 11),
  col('straddle', 'Straddle', 'yesno', 8),
  col('flop', 'Flop', 'text', 10),
  col('turn', 'Turn', 'text', 6),
  col('river', 'River', 'text', 6),
  col('finalPot', 'Final pot', 'money', 10),
  col('rake', 'Rake', 'money', 7),
  col('winners', 'Winner(s)', 'text', 30),
  col('winningHand', 'Winning hand', 'text', 32),
  col('myNet', 'My net result', 'money', 11),
  col('myNetBB', 'My net (BB)', 'bb', 10),
  col('showdown', 'Went to showdown', 'yesno', 10),
  col('sessionId', 'Session', 'text', 22),
];

export const ACTION_COLUMNS: Column[] = [
  col('handId', 'Hand ID', 'int', 15),
  col('n', 'Action #', 'int', 8),
  col('street', 'Street', 'text', 8),
  col('player', 'Player', 'text', 12),
  col('position', 'Position', 'text', 9),
  col('seat', 'Seat', 'int', 6),
  col('action', 'Action', 'text', 10),
  col('allInAs', 'All-in as', 'text', 9),
  col('detail', 'Detail', 'text', 14),
  col('amount', 'Amount added', 'money', 10),
  col('amountBB', 'Amount (BB)', 'bb', 9),
  col('to', 'Total bet on street (raise to)', 'money', 12),
  col('facing', 'Facing (to call)', 'money', 10),
  col('potBefore', 'Pot before', 'money', 10),
  col('potAfter', 'Pot after', 'money', 10),
  col('pctPot', 'Bet % of pot', 'pct', 9),
  col('stackBefore', 'Stack before', 'money', 10),
  col('stackAfter', 'Stack after', 'money', 10),
  col('effStack', 'Effective stack', 'money', 10),
  col('board', 'Board', 'text', 16),
  col('mine', 'Mine', 'yesno', 6),
];

export function playerColumns(includeStyles: boolean): Column[] {
  const cols = [
    col('handId', 'Hand ID', 'int', 15),
    col('seat', 'Seat', 'int', 6),
    col('name', 'Name', 'text', 12),
    col('playerId', 'Player ID', 'text', 10),
    col('position', 'Position', 'text', 9),
    col('startStack', 'Starting stack', 'money', 11),
    col('holeCards', 'Hole cards', 'text', 9),
    col('shown', 'Shown at showdown', 'yesno', 10),
    col('vpip', 'Put money in voluntarily', 'yesno', 10),
    col('result', 'Result', 'text', 12),
    col('net', 'Net result', 'money', 10),
    col('netBB', 'Net (BB)', 'bb', 9),
    col('myLabel', 'My label', 'text', 16),
  ];
  if (includeStyles) cols.push(col('trueStyle', 'True style', 'text', 20));
  return cols;
}

const STREET_LABEL: Record<string, string> = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };
const POST_DETAIL: Record<string, string> = { sb: 'small blind', bb: 'big blind', straddle: 'straddle', 'live-bb': 'posted to come in' };
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Who won what, e.g. "Walt $120 (main pot); Hero $40 (side pot 1)". */
function winnersText(rec: HandRecord): { winners: string; hands: string } {
  const awards = rec.hand.events.filter((e) => e.type === 'award');
  const winners = awards
    .map((a) => {
      if (a.type !== 'award') return '';
      const pot = a.potCount > 1 ? (a.potIndex === 0 ? ' (main pot)' : ` (side pot ${a.potIndex})`) : '';
      return `${playerName(rec, a.seat)} $${a.amount}${pot}`;
    })
    .join('; ');
  const seen = new Set<number>();
  const hands = awards
    .filter((a) => a.type === 'award' && a.description && !seen.has(a.seat) && seen.add(a.seat))
    .map((a) => (a.type === 'award' ? `${playerName(rec, a.seat)}: ${a.description}` : ''))
    .join('; ');
  return { winners, hands };
}

export function handRow(rec: HandRecord): Row {
  const h = rec.hand;
  const hero = h.players.find((p) => p.seat === rec.heroSeat);
  const { winners, hands } = winnersText(rec);
  const pots = h.result!.pots.reduce((a, p) => a + p.amount, 0);
  return {
    handId: rec.id,
    time: new Date(rec.startedAt),
    table: rec.tableName,
    stakes: rec.stakesLabel,
    players: h.players.length,
    buttonSeat: h.config.buttonSeat + 1,
    mySeat: rec.heroSeat + 1,
    myPosition: hero?.position ?? '',
    myCards: hero ? cardsToString(hero.hole) : '',
    myStartStack: hero?.startStack ?? null,
    straddle: h.config.straddleSeat != null,
    flop: h.board.length >= 3 ? cardsToString(h.board.slice(0, 3)) : '',
    turn: h.board.length >= 4 ? cardsToString([h.board[3]]) : '',
    river: h.board.length >= 5 ? cardsToString([h.board[4]]) : '',
    finalPot: pots + h.result!.rake,
    rake: h.result!.rake,
    winners,
    winningHand: hands,
    myNet: rec.heroNet,
    myNetBB: round2(rec.heroNet / h.config.bigBlind),
    showdown: h.result!.wentToShowdown,
    sessionId: rec.sessionId,
  };
}

export function actionRows(rec: HandRecord): Row[] {
  const h = rec.hand;
  const bb = h.config.bigBlind;
  const pos = new Map(h.players.map((p) => [p.seat, p.position]));
  const stacks = new Map(h.players.map((p) => [p.seat, p.startStack]));
  const folded = new Set<number>();
  const rows: Row[] = [];
  let pot = 0;
  let n = 0;
  let currentBet = 0;
  for (const e of h.events) {
    if (e.type === 'street') {
      currentBet = 0;
      continue;
    }
    if (e.type === 'uncalled') {
      const before = stacks.get(e.seat)!;
      stacks.set(e.seat, before + e.amount);
      rows.push({
        handId: rec.id, n: ++n, street: STREET_LABEL[e.street], player: playerName(rec, e.seat), position: pos.get(e.seat)!,
        seat: e.seat + 1, action: 'uncalled bet returned', allInAs: '', detail: '', amount: e.amount, amountBB: round2(e.amount / bb),
        to: null, facing: null, potBefore: pot, potAfter: pot - e.amount, pctPot: null, stackBefore: before, stackAfter: before + e.amount,
        effStack: null, board: cardsToString(boardAt(rec, e.street)), mine: e.seat === rec.heroSeat,
      });
      pot -= e.amount;
      continue;
    }
    if (e.type !== 'bet') continue;
    const eff = effectiveStack(e, stacks, folded);
    const bet = e as BetEvent;
    const committedBefore = bet.toAmount - bet.amount;
    let pct: number | null = null;
    if (bet.action === 'bet' && bet.potBefore > 0) pct = bet.amount / bet.potBefore;
    if (bet.action === 'raise') pct = (bet.toAmount - (committedBefore + bet.facing)) / (bet.potBefore + bet.facing);
    if (bet.action === 'bet' || bet.action === 'raise') currentBet = bet.toAmount;
    if (bet.action === 'post') currentBet = Math.max(currentBet, bet.toAmount);
    const label = bet.action === 'post' ? 'post' : bet.allIn ? 'all-in' : bet.action;
    rows.push({
      handId: rec.id,
      n: ++n,
      street: STREET_LABEL[bet.street],
      player: playerName(rec, bet.seat),
      position: pos.get(bet.seat)!,
      seat: bet.seat + 1,
      action: label,
      allInAs: bet.allIn ? bet.action : '',
      detail: bet.action === 'post' ? POST_DETAIL[bet.postKind ?? 'bb'] : bet.action === 'raise' ? `raise of $${bet.toAmount - (committedBefore + bet.facing)}` : '',
      amount: bet.amount,
      amountBB: round2(bet.amount / bb),
      to: bet.action === 'fold' || bet.action === 'check' ? null : bet.toAmount,
      facing: bet.facing,
      potBefore: bet.potBefore,
      potAfter: bet.potAfter,
      pctPot: pct === null ? null : round2(pct * 1000) / 1000,
      stackBefore: bet.stackBefore,
      stackAfter: bet.stackAfter,
      effStack: eff,
      board: cardsToString(bet.board),
      mine: bet.seat === rec.heroSeat,
    });
    pot = bet.potAfter;
    stacks.set(bet.seat, bet.stackAfter);
    if (bet.action === 'fold') folded.add(bet.seat);
  }
  void currentBet;
  return rows;
}

/** The smaller of your chips behind and the biggest stack behind among opponents still in. */
function effectiveStack(e: BetEvent, stacks: Map<number, number>, folded: Set<number>): number {
  const mine = stacks.get(e.seat)!;
  let biggest = 0;
  for (const [seat, s] of stacks) if (seat !== e.seat && !folded.has(seat)) biggest = Math.max(biggest, s);
  return Math.min(mine, biggest);
}

function boardAt(rec: HandRecord, street: string): number[] {
  const n = street === 'preflop' ? 0 : street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
  return rec.hand.board.slice(0, n);
}

export function playerRows(rec: HandRecord, opts: SheetOptions): Row[] {
  const h = rec.hand;
  const bb = h.config.bigBlind;
  const vpip = new Set(
    h.events.filter((e): e is BetEvent => e.type === 'bet' && e.street === 'preflop' && (e.action === 'call' || e.action === 'raise' || e.action === 'bet')).map((e) => e.seat),
  );
  const won = new Map<number, number>();
  for (const e of h.events) if (e.type === 'award') won.set(e.seat, (won.get(e.seat) ?? 0) + e.amount);
  return h.players.map((p) => {
    const isHero = p.seat === rec.heroSeat;
    const known = isHero || p.shown || rec.practiceMode;
    const net = h.result!.net[p.seat];
    const result = p.folded ? 'folded' : won.has(p.seat) ? (p.shown ? 'won at showdown' : 'won') : p.mucked ? 'lost at showdown' : p.shown ? 'lost at showdown' : 'lost';
    const style = ROSTER_BY_ID.get(p.id)?.archetype;
    const row: Row = {
      handId: rec.id,
      seat: p.seat + 1,
      name: isHero ? HERO_NAME : p.name,
      playerId: isHero ? 'hero' : p.id,
      position: p.position,
      startStack: p.startStack,
      holeCards: known ? cardsToString(p.hole) : '',
      shown: p.shown,
      vpip: vpip.has(p.seat),
      result,
      net,
      netBB: round2(net / bb),
      myLabel: isHero ? '' : opts.labelFor?.(p.id) ?? '',
    };
    if (opts.includeStyles) row.trueStyle = isHero ? '' : style ? ARCHETYPE_LABELS[style] : '';
    return row;
  });
}

export function buildSheets(records: HandRecord[], opts: SheetOptions): Sheet[] {
  const sorted = records.slice().sort((a, b) => a.id - b.id);
  return [
    { name: 'Hands', columns: HAND_COLUMNS, rows: sorted.map(handRow) },
    { name: 'Actions', columns: ACTION_COLUMNS, rows: sorted.flatMap(actionRows) },
    { name: 'Players', columns: playerColumns(opts.includeStyles), rows: sorted.flatMap((r) => playerRows(r, opts)) },
  ];
}

/** Explanations included as a fourth sheet / in the export dialog. */
export const NOTES: string[][] = [
  ['Topic', 'Explanation'],
  ['Hero', 'You. "Mine" in the Actions sheet marks your actions.'],
  ['Positions', 'UTG is first to act preflop; then UTG+1, UTG+2, MP, LJ, HJ, CO, BTN, SB, BB. Heads-up the button is BTN/SB.'],
  ['Amount added', 'Chips this action put into the pot.'],
  ['Total bet on street (raise to)', "The player's total on this street after acting. For a raise, the \"raise to\" amount."],
  ['Facing (to call)', 'How much the player had to call before acting.'],
  ['Pot before / after', 'All chips in the middle, including bets already made on this street.'],
  ['Bet % of pot', 'A bet divided by the pot before it. A raise: the extra amount (beyond calling) divided by the pot after calling, so a pot-sized raise is 100%.'],
  ['All-in as', 'When the action put the player all-in: whether it was a call, bet, raise or a blind.'],
  ['Effective stack', 'The smaller of the player\'s chips behind and the biggest stack behind among opponents still in the hand, before the action.'],
  ['uncalled bet returned', 'The part of a bet nobody called, given back to the bettor.'],
  ['Final pot', 'Everything in the pot at the end, before rake.'],
  ['Hole cards (Players sheet)', 'Shown when the player showed them at showdown, always for you, and for everyone in practice-mode hands.'],
  ['Net result', 'Chips won minus chips put in during the hand.'],
  ['Amounts', 'In dollars; the (BB) columns divide by the big blind.'],
];
