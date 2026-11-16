import { AiDirector } from '../ai/director';
import { ROSTER } from '../ai/roster';
import { shuffledDeck } from '../engine/deck';
import { applyAction, startHand } from '../engine/hand';
import { seededRng } from '../engine/rng';
import { NEW_BUTTON_STATE, planNextHand, type ButtonState } from '../engine/table';
import { getPlayerView } from '../engine/view';
import { Seating } from '../table/seating';
import { STAKES } from '../table/stakes';
import { makeRecord, type HandRecord } from './record';

/**
 * Realistic hand records for tests: computer players play each other, and the
 * player in seat 0 stands in for "you". Includes straddles, short stacks and
 * all-ins, so side pots and uncalled bets show up.
 */
export function simulateRecords(count: number, seed = 1, stakeIndex = 0, practiceMode = true): HandRecord[] {
  const stake = STAKES[stakeIndex];
  const rng = seededRng(seed);
  const seating = new Seating(stake, rng);
  const director = new AiDirector(seating, rng);
  const players = ROSTER.slice().sort(() => rng.float() - 0.5).slice(0, 8);
  const stacks = players.map((p) => seating.buyInFor(p));
  let button: ButtonState = NEW_BUTTON_STATE;
  const out: HandRecord[] = [];
  for (let h = 0; h < count; h++) {
    for (let i = 0; i < stacks.length; i++) if (stacks[i] === 0) stacks[i] = seating.buyInFor(players[i]);
    const plan = planNextHand(stacks.map((stack, seat) => ({ seat, stack, status: 'active' })), 10, button, rng)!;
    button = plan.next;
    const afterBB = [...plan.dealtIn.filter((x) => x > plan.bbSeat), ...plan.dealtIn.filter((x) => x <= plan.bbSeat)];
    const straddle = plan.dealtIn.length >= 4 && rng.float() < 0.15 && stacks[afterBB[0]] > 2 * stake.bigBlind ? afterBB[0] : null;
    let hand = startHand(
      {
        handId: `t${h}`, numSeats: 10, smallBlind: stake.smallBlind, bigBlind: stake.bigBlind,
        players: plan.dealtIn.map((seat) => ({ seat, id: players[seat].id, name: players[seat].name, stack: stacks[seat] })),
        buttonSeat: plan.buttonSeat, sbSeat: plan.sbSeat, bbSeat: plan.bbSeat, straddleSeat: straddle,
        startedAt: Date.UTC(2026, 10, 16, 14, 0, 0) + h * 60_000,
      },
      shuffledDeck(rng),
    );
    while (hand.phase !== 'complete') {
      const seat = hand.toAct!;
      const occ = { seat, id: players[seat].id, name: players[seat].name, stack: 0, status: 'active' as const, isHero: false };
      hand = applyAction(hand, seat, director.decide(occ, getPlayerView(hand, seat)));
    }
    director.afterHand(hand);
    for (const p of hand.players) stacks[p.seat] = p.stack;
    out.push(makeRecord(hand, {
      id: 100_000 + h, sessionId: 'test-session', stakeId: stake.id, stakesLabel: stake.label,
      tableName: stake.name, heroSeat: 0, practiceMode, endedAt: hand.config.startedAt! + 30_000,
    }));
  }
  return out;
}
