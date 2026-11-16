import { cardsToString } from '../engine/cards';
import type { BetEvent, HandEvent } from '../engine/types';
import { HERO_NAME, playerName, type HandRecord } from './record';

/**
 * Hand histories in the PokerStars text format, so they can be pasted into a
 * chat or imported into tracking and study tools.
 */
export interface TextOptions {
  /**
   * In practice-mode hands, add "Dealt to <player> [cards]" for everyone and show
   * mucked cards. Handy for reviews; turn it off for strict tracker imports.
   */
  allHoleCards?: boolean;
}

const $ = (n: number) => `$${n}`;

/** "2026/11/16 9:05:33 ET" in US Eastern time, as PokerStars writes it. */
export function easternTime(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}/${get('month')}/${get('day')} ${Number(get('hour'))}:${get('minute')}:${get('second')} ET`;
}

/** Short table name without "/" (some tools dislike it), e.g. "Practice 1-3". */
export function psTableName(rec: HandRecord): string {
  return `Practice ${rec.stakeId}`;
}

export function toPokerStars(rec: HandRecord, opts: TextOptions = {}): string {
  const h = rec.hand;
  const cfg = h.config;
  const name = (seat: number) => playerName(rec, seat);
  const revealAll = !!opts.allHoleCards && rec.practiceMode;
  const lines: string[] = [];

  lines.push(`PokerStars Hand #${rec.id}:  Hold'em No Limit (${$(cfg.smallBlind)}/${$(cfg.bigBlind)} USD) - ${easternTime(rec.startedAt)}`);
  lines.push(`Table '${psTableName(rec)}' ${cfg.numSeats}-max Seat #${cfg.buttonSeat + 1} is the button`);
  for (const p of h.players) lines.push(`Seat ${p.seat + 1}: ${name(p.seat)} (${$(p.startStack)} in chips)`);

  const events = h.events;
  const posts = events.filter((e): e is BetEvent => e.type === 'bet' && e.action === 'post');
  for (const e of posts) {
    const what = e.postKind === 'sb' ? 'small blind' : e.postKind === 'straddle' ? 'straddle' : 'big blind';
    lines.push(`${name(e.seat)}: posts ${what} ${$(e.amount)}${e.allIn ? ' and is all-in' : ''}`);
  }

  lines.push('*** HOLE CARDS ***');
  const hero = h.players.find((p) => p.seat === rec.heroSeat);
  if (hero) lines.push(`Dealt to ${HERO_NAME} [${cardsToString(hero.hole)}]`);
  if (revealAll) {
    for (const p of h.players) if (p.seat !== rec.heroSeat) lines.push(`Dealt to ${name(p.seat)} [${cardsToString(p.hole)}]`);
  }

  // Betting, streets, showdown and payouts, in order.
  let currentBet = cfg.straddleSeat != null ? 2 * cfg.bigBlind : cfg.bigBlind;
  let showdownHeader = false;
  const pots = h.result!.pots;
  for (const e of events) {
    if (e.type === 'bet' && e.action === 'post') continue;
    lines.push(...eventLines(e));
  }

  function eventLines(e: HandEvent): string[] {
    switch (e.type) {
      case 'bet': {
        const n = name(e.seat);
        const allIn = e.allIn ? ' and is all-in' : '';
        switch (e.action) {
          case 'fold': return [`${n}: folds`];
          case 'check': return [`${n}: checks`];
          case 'call': return [`${n}: calls ${$(e.amount)}${allIn}`];
          case 'bet':
            currentBet = e.toAmount;
            return [`${n}: bets ${$(e.amount)}${allIn}`];
          case 'raise': {
            const by = e.toAmount - currentBet;
            currentBet = e.toAmount;
            return [`${n}: raises ${$(by)} to ${$(e.toAmount)}${allIn}`];
          }
          default: return [];
        }
      }
      case 'street': {
        currentBet = 0;
        const prev = e.board.slice(0, e.board.length - e.cards.length);
        const title = e.street.toUpperCase();
        return [prev.length ? `*** ${title} *** [${cardsToString(prev)}] [${cardsToString(e.cards)}]` : `*** ${title} *** [${cardsToString(e.cards)}]`];
      }
      case 'uncalled':
        return [`Uncalled bet (${$(e.amount)}) returned to ${name(e.seat)}`];
      case 'show': {
        const head = showdownHeader ? [] : ['*** SHOW DOWN ***'];
        showdownHeader = true;
        return [...head, `${name(e.seat)}: shows [${cardsToString(e.cards)}] (${e.description})`];
      }
      case 'muck': {
        const head = showdownHeader ? [] : ['*** SHOW DOWN ***'];
        showdownHeader = true;
        return [...head, `${name(e.seat)}: mucks hand`];
      }
      case 'award': {
        const from = e.potCount <= 1 ? 'pot' : e.potIndex === 0 ? 'main pot' : `side pot-${e.potIndex}`;
        const out = [`${name(e.seat)} collected ${$(e.amount)} from ${from}`];
        if (!h.result!.wentToShowdown) out.push(`${name(e.seat)}: doesn't show hand`);
        return out;
      }
      default:
        return [];
    }
  }

  // Summary.
  lines.push('*** SUMMARY ***');
  const rake = h.result!.rake;
  const potSum = pots.reduce((a, p) => a + p.amount, 0);
  const total = potSum + rake;
  if (pots.length > 1) {
    const parts = pots.map((p, i) => (i === 0 ? `Main pot ${$(p.amount)}.` : `Side pot-${i} ${$(p.amount)}.`));
    lines.push(`Total pot ${$(total)} ${parts.join(' ')} | Rake ${$(rake)}`);
  } else {
    lines.push(`Total pot ${$(total)} | Rake ${$(rake)}`);
  }
  if (h.board.length) lines.push(`Board [${cardsToString(h.board)}]`);

  const won = new Map<number, number>();
  const desc = new Map<number, string>();
  for (const e of events) {
    if (e.type === 'award') won.set(e.seat, (won.get(e.seat) ?? 0) + e.amount);
    if (e.type === 'show') desc.set(e.seat, e.description);
  }
  const foldStreet = new Map<number, string>();
  for (const e of events) if (e.type === 'bet' && e.action === 'fold') foldStreet.set(e.seat, e.street);
  const voluntarilyBet = new Set(
    events.filter((e): e is BetEvent => e.type === 'bet' && e.action !== 'fold' && e.action !== 'check').map((e) => e.seat),
  );

  for (const p of h.players) {
    const roles: string[] = [];
    if (p.seat === cfg.buttonSeat) roles.push('(button)');
    if (p.seat === cfg.sbSeat) roles.push('(small blind)');
    if (p.seat === cfg.bbSeat) roles.push('(big blind)');
    const who = `Seat ${p.seat + 1}: ${name(p.seat)}${roles.length ? ' ' + roles.join(' ') : ''}`;
    const knownCards = p.seat === rec.heroSeat || revealAll;
    let outcome: string;
    if (p.folded) {
      const st = foldStreet.get(p.seat) ?? 'preflop';
      outcome = st === 'preflop'
        ? `folded before Flop${voluntarilyBet.has(p.seat) ? '' : " (didn't bet)"}`
        : `folded on the ${st[0].toUpperCase()}${st.slice(1)}`;
    } else if (p.shown) {
      const w = won.get(p.seat);
      outcome = w
        ? `showed [${cardsToString(p.hole)}] and won (${$(w)}) with ${desc.get(p.seat)}`
        : `showed [${cardsToString(p.hole)}] and lost with ${desc.get(p.seat)}`;
    } else if (p.mucked) {
      outcome = knownCards ? `mucked [${cardsToString(p.hole)}]` : 'mucked';
    } else {
      outcome = `collected (${$(won.get(p.seat) ?? 0)})`;
    }
    lines.push(`${who} ${outcome}`);
  }
  return lines.join('\n');
}

/** Several hands, separated the way PokerStars separates them. */
export function toPokerStarsFile(records: HandRecord[], opts: TextOptions = {}): string {
  return records.map((r) => toPokerStars(r, opts)).join('\n\n\n') + '\n';
}
