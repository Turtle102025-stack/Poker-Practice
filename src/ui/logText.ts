import { cardsToString } from '../engine/cards';
import type { HandEvent, HandState } from '../engine/types';

export interface LogLine {
  text: string;
  kind: 'street' | 'win' | 'hero' | 'normal' | 'dealt';
}

/** Human-readable lines for the on-screen action log. */
export function logLines(hand: HandState, heroSeat?: number): LogLine[] {
  const name = (seat: number) => {
    const p = hand.players.find((x) => x.seat === seat)!;
    return `${seat === heroSeat ? 'You' : p.name} (${p.position})`;
  };
  const lines: LogLine[] = [];
  let dealtShown = false;
  const addDealt = () => {
    if (dealtShown) return;
    dealtShown = true;
    const hero = hand.players.find((p) => p.seat === heroSeat);
    lines.push({ kind: 'street', text: '*** HOLE CARDS ***' });
    if (hero) lines.push({ kind: 'dealt', text: `Dealt to You [${cardsToString(hero.hole)}]` });
  };
  for (const e of hand.events) {
    if (!(e.type === 'bet' && e.action === 'post')) addDealt();
    const text = eventText(e, name);
    if (!text) continue;
    const kind: LogLine['kind'] =
      e.type === 'street' ? 'street'
      : e.type === 'award' ? 'win'
      : 'seat' in e && e.seat === heroSeat ? 'hero'
      : 'normal';
    lines.push({ text, kind });
  }
  addDealt();
  return lines;
}

/** Plain strings (used by the terminal version). */
export function eventLines(hand: HandState, heroSeat?: number): string[] {
  return logLines(hand, heroSeat).map((l) => l.text);
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

function eventText(e: HandEvent, name: (seat: number) => string): string | null {
  switch (e.type) {
    case 'bet': {
      const allIn = e.allIn ? ' and is all-in' : '';
      switch (e.action) {
        case 'post': {
          const label =
            e.postKind === 'sb' ? 'small blind' : e.postKind === 'bb' ? 'big blind'
            : e.postKind === 'straddle' ? 'straddle' : 'live big blind';
          return `${name(e.seat)}: posts ${label} ${money(e.amount)}${allIn}`;
        }
        case 'fold': return `${name(e.seat)}: folds`;
        case 'check': return `${name(e.seat)}: checks`;
        case 'call': return `${name(e.seat)}: calls ${money(e.amount)}${allIn}`;
        case 'bet': return `${name(e.seat)}: bets ${money(e.amount)}${allIn}`;
        case 'raise': return `${name(e.seat)}: raises to ${money(e.toAmount)}${allIn}`;
      }
      return null;
    }
    case 'street': {
      const prev = e.board.slice(0, e.board.length - e.cards.length);
      const shown = prev.length ? `[${cardsToString(prev)}] [${cardsToString(e.cards)}]` : `[${cardsToString(e.cards)}]`;
      return `*** ${e.street.toUpperCase()} *** ${shown}  (pot ${money(e.pot)})`;
    }
    case 'uncalled':
      return `Uncalled bet (${money(e.amount)}) returned to ${name(e.seat)}`;
    case 'show':
      return `${name(e.seat)}: shows [${cardsToString(e.cards)}] (${e.description})`;
    case 'muck':
      return `${name(e.seat)}: mucks hand`;
    case 'rake':
      return `Rake: ${money(e.amount)}`;
    case 'award': {
      const pot = e.potCount > 1 ? (e.potIndex === 0 ? ' from the main pot' : ` from side pot ${e.potIndex}`) : '';
      const how = e.description ? ` with ${e.description}` : '';
      return `${name(e.seat)} wins ${money(e.amount)}${pot}${how}`;
    }
  }
}
