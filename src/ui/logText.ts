import { cardsToString } from '../engine/cards';
import type { HandEvent, HandState } from '../engine/types';

/** Human-readable lines for the on-screen action log. */
export function eventLines(hand: HandState, heroSeat?: number): string[] {
  const name = (seat: number) => {
    const p = hand.players.find((x) => x.seat === seat)!;
    const who = seat === heroSeat ? 'You' : p.name;
    return `${who} (${p.position})`;
  };
  const lines: string[] = [];
  for (const e of hand.events) lines.push(...eventToLines(e, name, hand));
  return lines;
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

function eventToLines(e: HandEvent, name: (seat: number) => string, hand: HandState): string[] {
  switch (e.type) {
    case 'bet': {
      const allIn = e.allIn ? ' and is all-in' : '';
      switch (e.action) {
        case 'post': {
          const label =
            e.postKind === 'sb' ? 'small blind' : e.postKind === 'bb' ? 'big blind'
            : e.postKind === 'straddle' ? 'straddle' : 'live big blind';
          return [`${name(e.seat)}: posts ${label} ${money(e.amount)}${allIn}`];
        }
        case 'fold': return [`${name(e.seat)}: folds`];
        case 'check': return [`${name(e.seat)}: checks`];
        case 'call': return [`${name(e.seat)}: calls ${money(e.amount)}${allIn}`];
        case 'bet': return [`${name(e.seat)}: bets ${money(e.amount)}${allIn}`];
        case 'raise': return [`${name(e.seat)}: raises to ${money(e.toAmount)}${allIn}`];
      }
      return [];
    }
    case 'street': {
      const title = e.street.toUpperCase();
      const prev = e.board.slice(0, e.board.length - e.cards.length);
      const shown = prev.length ? `[${cardsToString(prev)}] [${cardsToString(e.cards)}]` : `[${cardsToString(e.cards)}]`;
      return [`*** ${title} *** ${shown}   (pot ${money(e.pot)})`];
    }
    case 'uncalled':
      return [`Uncalled bet (${money(e.amount)}) returned to ${name(e.seat)}`];
    case 'show':
      return [`${name(e.seat)}: shows [${cardsToString(e.cards)}] (${e.description})`];
    case 'muck':
      return [`${name(e.seat)}: mucks hand`];
    case 'rake':
      return [`Rake: ${money(e.amount)}`];
    case 'award': {
      const pot = e.potCount > 1 ? (e.potIndex === 0 ? ' from the main pot' : ` from side pot ${e.potIndex}`) : '';
      const how = e.description ? ` with ${e.description}` : '';
      void hand;
      return [`${name(e.seat)} wins ${money(e.amount)}${pot}${how}`];
    }
  }
}
