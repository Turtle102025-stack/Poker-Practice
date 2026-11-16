import { shuffledDeck } from '../engine/deck';
import { applyAction, startHand } from '../engine/hand';
import { seededRng } from '../engine/rng';
import { NEW_BUTTON_STATE, planNextHand, type ButtonState } from '../engine/table';
import { getPlayerView } from '../engine/view';
import type { Occupant } from '../table/controller';
import { Seating } from '../table/seating';
import { STAKES, type Stake } from '../table/stakes';
import type { Archetype } from './archetypes';
import { AiDirector } from './director';
import { emptyCounts, summarize, type ObservedStats, type StatCounts } from './publicStats';
import { ROSTER, ROSTER_BY_ID } from './roster';

/**
 * Measures how the computer players actually play: full tables of them play
 * each other and we tally the same stats a player would observe at the table.
 */
export interface ArchetypeReport extends ObservedStats {
  archetype: Archetype;
  /** Win rate in big blinds per 100 hands. */
  bbPer100: number;
}

/** Target ranges (fractions) used by the tests and printed by the script. */
export const TARGETS: Record<Archetype, { vpip: [number, number]; pfr: [number, number] }> = {
  nit: { vpip: [0.08, 0.15], pfr: [0.06, 0.12] },
  semiNit: { vpip: [0.13, 0.21], pfr: [0.09, 0.16] },
  tightPassive: { vpip: [0.13, 0.24], pfr: [0.02, 0.08] },
  loosePassive: { vpip: [0.38, 0.6], pfr: [0.03, 0.1] },
  looseAggressive: { vpip: [0.38, 0.6], pfr: [0.16, 0.32] },
  aggroReg: { vpip: [0.24, 0.36], pfr: [0.19, 0.3] },
  goodReg: { vpip: [0.19, 0.29], pfr: [0.15, 0.24] },
  shortStacker: { vpip: [0.13, 0.25], pfr: [0.1, 0.22] },
};

export function runCalibration(opts: { hands: number; seed: number; stake?: Stake; tableSize?: number; reshuffleEvery?: number }): ArchetypeReport[] {
  const stake = opts.stake ?? STAKES[0];
  const size = opts.tableSize ?? 9;
  const rng = seededRng(opts.seed);
  const seating = new Seating(stake, rng);
  const director = new AiDirector(seating, rng);
  const net = new Map<string, number>();
  const handsPlayed = new Map<string, number>();
  let seats: Array<Occupant | null> = [];
  let button: ButtonState = NEW_BUTTON_STATE;

  const reseat = () => {
    const picked = new Set<string>();
    while (picked.size < size) picked.add(ROSTER[rng.int(ROSTER.length)].id);
    seats = [...picked].map((id, seat) => {
      const p = ROSTER_BY_ID.get(id)!;
      return { seat, id, name: p.name, stack: seating.buyInFor(p), status: 'active' as const, isHero: false };
    });
    button = NEW_BUTTON_STATE;
  };

  for (let h = 0; h < opts.hands; h++) {
    if (h % (opts.reshuffleEvery ?? 150) === 0) reseat();
    for (const o of seats) if (o && o.stack === 0) o.stack = seating.buyInFor(ROSTER_BY_ID.get(o.id)!);
    const plan = planNextHand(
      seats.filter((o): o is Occupant => !!o).map((o) => ({ seat: o.seat, stack: o.stack, status: o.status })),
      size, button, rng,
    )!;
    button = plan.next;
    let hand = startHand(
      {
        handId: `cal-${h}`,
        numSeats: size,
        smallBlind: stake.smallBlind,
        bigBlind: stake.bigBlind,
        players: plan.dealtIn.map((seat) => ({ seat, id: seats[seat]!.id, name: seats[seat]!.name, stack: seats[seat]!.stack })),
        buttonSeat: plan.buttonSeat,
        sbSeat: plan.sbSeat,
        bbSeat: plan.bbSeat,
      },
      shuffledDeck(rng),
    );
    while (hand.phase !== 'complete') {
      const seat = hand.toAct!;
      hand = applyAction(hand, seat, director.decide(seats[seat]!, getPlayerView(hand, seat)));
    }
    director.afterHand(hand);
    for (const p of hand.players) {
      seats[p.seat]!.stack = p.stack;
      net.set(p.id, (net.get(p.id) ?? 0) + hand.result!.net[p.seat]);
      handsPlayed.set(p.id, (handsPlayed.get(p.id) ?? 0) + 1);
    }
  }

  // Combine per-player counts into per-style totals.
  const byStyle = new Map<Archetype, { counts: StatCounts; net: number; hands: number }>();
  for (const [id, c] of director.stats.counts) {
    const a = ROSTER_BY_ID.get(id)!.archetype;
    const agg = byStyle.get(a) ?? { counts: emptyCounts(), net: 0, hands: 0 };
    for (const k of Object.keys(c) as Array<keyof StatCounts>) agg.counts[k] += c[k];
    agg.net += net.get(id) ?? 0;
    agg.hands += handsPlayed.get(id) ?? 0;
    byStyle.set(a, agg);
  }
  return [...byStyle.entries()].map(([archetype, agg]) => ({
    archetype,
    ...summarize(agg.counts),
    bbPer100: agg.hands ? (agg.net / stake.bigBlind / agg.hands) * 100 : 0,
  }));
}
