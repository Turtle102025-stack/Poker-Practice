import type { BetEvent, HandState } from '../engine/types';

/**
 * Stats anyone at the table could keep by watching: how often each player
 * puts money in preflop, raises, 3-bets, limps, continuation-bets, folds to
 * continuation bets, and goes to showdown. Built only from public actions
 * (never from hidden hole cards).
 */
export interface StatCounts {
  hands: number;
  vpip: number;
  pfr: number;
  limp: number;
  threeBetOpp: number;
  threeBet: number;
  cbetOpp: number;
  cbet: number;
  foldToCbetOpp: number;
  foldToCbet: number;
  sawFlop: number;
  wentToShowdown: number;
  postflopAggressive: number;
  postflopCalls: number;
}

export interface ObservedStats {
  hands: number;
  /** Fractions 0..1, or null when there is no sample yet. */
  vpip: number | null;
  pfr: number | null;
  limp: number | null;
  threeBet: number | null;
  cbet: number | null;
  foldToCbet: number | null;
  wtsd: number | null;
  /** Postflop aggression factor: (bets + raises) / calls. */
  af: number | null;
}

export function emptyCounts(): StatCounts {
  return {
    hands: 0, vpip: 0, pfr: 0, limp: 0, threeBetOpp: 0, threeBet: 0, cbetOpp: 0, cbet: 0,
    foldToCbetOpp: 0, foldToCbet: 0, sawFlop: 0, wentToShowdown: 0, postflopAggressive: 0, postflopCalls: 0,
  };
}

export function summarize(c: StatCounts): ObservedStats {
  const f = (n: number, d: number) => (d > 0 ? n / d : null);
  return {
    hands: c.hands,
    vpip: f(c.vpip, c.hands),
    pfr: f(c.pfr, c.hands),
    limp: f(c.limp, c.hands),
    threeBet: f(c.threeBet, c.threeBetOpp),
    cbet: f(c.cbet, c.cbetOpp),
    foldToCbet: f(c.foldToCbet, c.foldToCbetOpp),
    wtsd: f(c.wentToShowdown, c.sawFlop),
    af: c.postflopCalls > 0 ? c.postflopAggressive / c.postflopCalls : c.postflopAggressive > 0 ? 5 : null,
  };
}

/** Adds one finished hand's public actions to the counts (keyed by player id). */
export function recordHand(hand: HandState, counts: Map<string, StatCounts>): void {
  const idOf = new Map(hand.players.map((p) => [p.seat, p.id]));
  const get = (seat: number) => {
    const id = idOf.get(seat)!;
    let c = counts.get(id);
    if (!c) counts.set(id, (c = emptyCounts()));
    return c;
  };
  for (const p of hand.players) get(p.seat).hands++;

  const bets = hand.events.filter((e): e is BetEvent => e.type === 'bet' && e.action !== 'post');
  const preflop = bets.filter((e) => e.street === 'preflop');

  // Preflop.
  const vpip = new Set<number>();
  const pfr = new Set<number>();
  const seenFirst = new Set<number>();
  const threeBetCounted = new Set<number>();
  let raises = 0;
  let lastRaiser: number | null = null;
  for (const e of preflop) {
    if (e.action === 'call' || e.action === 'raise' || e.action === 'bet') vpip.add(e.seat);
    if (e.action === 'raise') pfr.add(e.seat);
    if (!seenFirst.has(e.seat)) {
      seenFirst.add(e.seat);
      if (raises === 0 && e.action === 'call') get(e.seat).limp++;
    }
    if (raises === 1 && !threeBetCounted.has(e.seat) && e.seat !== lastRaiser) {
      threeBetCounted.add(e.seat);
      get(e.seat).threeBetOpp++;
      if (e.action === 'raise') get(e.seat).threeBet++;
    }
    if (e.action === 'raise') {
      raises++;
      lastRaiser = e.seat;
    }
  }
  for (const s of vpip) get(s).vpip++;
  for (const s of pfr) get(s).pfr++;

  // Who saw the flop.
  const flopEvent = hand.events.findIndex((e) => e.type === 'street' && e.street === 'flop');
  if (flopEvent < 0) return;
  const foldedBeforeFlop = new Set(
    hand.events.slice(0, flopEvent).filter((e): e is BetEvent => e.type === 'bet' && e.action === 'fold').map((e) => e.seat),
  );
  const sawFlop = hand.players.filter((p) => !foldedBeforeFlop.has(p.seat)).map((p) => p.seat);
  for (const s of sawFlop) {
    get(s).sawFlop++;
    const p = hand.players.find((x) => x.seat === s)!;
    if (hand.result?.wentToShowdown && !p.folded) get(s).wentToShowdown++;
  }

  // Continuation bets: the preflop raiser's first chance on the flop.
  const flop = bets.filter((e) => e.street === 'flop');
  if (lastRaiser !== null && sawFlop.includes(lastRaiser)) {
    const firstBetIdx = flop.findIndex((e) => e.action === 'bet');
    const raiserFirst = flop.findIndex((e) => e.seat === lastRaiser);
    if (raiserFirst >= 0 && (firstBetIdx < 0 || firstBetIdx >= raiserFirst)) {
      get(lastRaiser).cbetOpp++;
      if (flop[raiserFirst].action === 'bet') {
        get(lastRaiser).cbet++;
        // Players facing the c-bet before anyone raises.
        const responded = new Set<number>();
        for (const e of flop.slice(raiserFirst + 1)) {
          if (e.action === 'raise') break;
          if (responded.has(e.seat) || e.seat === lastRaiser) continue;
          responded.add(e.seat);
          get(e.seat).foldToCbetOpp++;
          if (e.action === 'fold') get(e.seat).foldToCbet++;
        }
      }
    }
  }

  // Postflop aggression.
  for (const e of bets) {
    if (e.street === 'preflop') continue;
    if (e.action === 'bet' || e.action === 'raise') get(e.seat).postflopAggressive++;
    else if (e.action === 'call') get(e.seat).postflopCalls++;
  }
}

/** A table-wide stats book. */
export class PublicStats {
  readonly counts = new Map<string, StatCounts>();
  record(hand: HandState): void {
    recordHand(hand, this.counts);
  }
  get(id: string): ObservedStats {
    return summarize(this.counts.get(id) ?? emptyCounts());
  }
}
