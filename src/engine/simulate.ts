import { shuffledDeck } from './deck';
import { applyAction, legalActions, startHand } from './hand';
import { referenceEvaluate } from './referenceEvaluator';
import { seededRng, type Rng } from './rng';
import { NEW_BUTTON_STATE, planNextHand, type ButtonState, type SeatStatus } from './table';
import { IllegalActionError, type HandConfig, type HandState, type PlayerAction } from './types';

/**
 * Rules stress test. Random players with random (often tiny) stacks make
 * random legal decisions while players come and go. After every action the
 * simulator checks invariants; after every hand it checks the payout against
 * an independent evaluator. Any violation is recorded as an error.
 */

export interface SimReport {
  hands: number;
  actions: number;
  showdowns: number;
  sidePotHands: number;
  splitPots: number;
  allInRunouts: number;
  straddles: number;
  livePosts: number;
  deadButtons: number;
  deadSmallBlinds: number;
  headsUpHands: number;
  rakedHands: number;
  illegalAttemptsRejected: number;
  errors: string[];
}

interface SimSeat {
  seat: number;
  id: string;
  stack: number;
  status: SeatStatus;
}

const STAKES: Array<[number, number]> = [[1, 3], [2, 5], [5, 10], [10, 20], [50, 100]];
const MAX_ERRORS = 25;

export class Simulator {
  readonly report: SimReport = {
    hands: 0, actions: 0, showdowns: 0, sidePotHands: 0, splitPots: 0, allInRunouts: 0,
    straddles: 0, livePosts: 0, deadButtons: 0, deadSmallBlinds: 0, headsUpHands: 0,
    rakedHands: 0, illegalAttemptsRejected: 0, errors: [],
  };
  private rng: Rng;
  private seats: Array<SimSeat | null>;
  private buttonState: ButtonState = NEW_BUTTON_STATE;
  private nextId = 1;
  private sb: number;
  private bb: number;
  private readonly numSeats: number;

  constructor(seed = Date.now(), numSeats = 10) {
    this.rng = seededRng(seed);
    this.numSeats = numSeats;
    this.seats = Array.from({ length: numSeats }, () => null);
    [this.sb, this.bb] = STAKES[this.rng.int(STAKES.length)];
    const initial = 2 + this.rng.int(numSeats - 1);
    for (let i = 0; i < initial; i++) this.addPlayer('active');
  }

  private randomStack(): number {
    const r = this.rng.float();
    if (r < 0.15) return 1 + this.rng.int(this.bb * 3); // tiny: forces short blinds and side pots
    if (r < 0.5) return this.bb * (10 + this.rng.int(40));
    return this.bb * (40 + this.rng.int(260));
  }

  private addPlayer(status: SeatStatus): void {
    const empty = this.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
    if (empty.length === 0) return;
    const seat = empty[this.rng.int(empty.length)];
    this.seats[seat] = { seat, id: `p${this.nextId++}`, stack: this.randomStack(), status };
  }

  private fail(msg: string): void {
    if (this.report.errors.length < MAX_ERRORS) this.report.errors.push(`hand ${this.report.hands + 1}: ${msg}`);
  }

  /** Plays `count` hands. Returns false once the error limit is reached. */
  runBatch(count: number): boolean {
    for (let i = 0; i < count; i++) {
      try {
        this.playOneHand();
      } catch (e) {
        this.fail(`exception: ${(e as Error).stack ?? e}`);
      }
      this.report.hands++;
      if (this.report.errors.length >= MAX_ERRORS) return false;
    }
    return true;
  }

  private churn(): void {
    for (let i = 0; i < this.numSeats; i++) {
      const s = this.seats[i];
      if (!s) continue;
      if (s.stack === 0) {
        if (this.rng.float() < 0.5) s.stack = this.randomStack(); // rebuy, stays active
        else this.seats[i] = null;
      } else if (this.rng.float() < 0.04) {
        this.seats[i] = null;
      }
    }
    if (this.rng.float() < 0.35) this.addPlayer(this.rng.float() < 0.5 ? 'waitingForBB' : 'postToEnter');
    while (this.seats.filter(Boolean).length < 2) this.addPlayer('active');
  }

  private playOneHand(): void {
    this.churn();
    const infos = this.seats.filter((s): s is SimSeat => !!s).map((s) => ({ seat: s.seat, stack: s.stack, status: s.status }));
    const plan = planNextHand(infos, this.numSeats, this.buttonState, this.rng);
    if (!plan) {
      this.addPlayer('active');
      return;
    }
    this.checkPlan(plan.bbSeat, plan.sbSeat, plan.buttonSeat, plan.dealtIn);
    this.buttonState = plan.next;
    for (const seat of plan.entering) this.seats[seat]!.status = 'active';

    const players = plan.dealtIn.map((seat) => {
      const s = this.seats[seat]!;
      return { seat, id: s.id, name: s.id, stack: s.stack };
    });

    // Maybe a UTG straddle.
    let straddleSeat: number | null = null;
    if (players.length >= 4 && this.rng.float() < 0.2) {
      const sorted = plan.dealtIn;
      const afterBB = [...sorted.filter((x) => x > plan.bbSeat), ...sorted.filter((x) => x <= plan.bbSeat)];
      const utg = afterBB[0];
      const st = this.seats[utg]!;
      if (!plan.livePosters.includes(utg) && st.stack > 2 * this.bb) straddleSeat = utg;
    }

    const config: HandConfig = {
      handId: `sim-${this.report.hands + 1}`,
      numSeats: this.numSeats,
      smallBlind: this.sb,
      bigBlind: this.bb,
      players,
      buttonSeat: plan.buttonSeat,
      sbSeat: plan.sbSeat,
      bbSeat: plan.bbSeat,
      livePosters: plan.livePosters,
      straddleSeat,
      rake: this.rng.float() < 0.3 ? { enabled: true, percent: 10, cap: 5, noFlopNoDrop: true } : undefined,
    };
    if (straddleSeat !== null) this.report.straddles++;
    this.report.livePosts += plan.livePosters.length;
    if (!plan.dealtIn.includes(plan.buttonSeat)) this.report.deadButtons++;
    if (plan.sbSeat === null) this.report.deadSmallBlinds++;
    if (players.length === 2) this.report.headsUpHands++;

    const total = players.reduce((a, p) => a + p.stack, 0);
    let s = startHand(config, shuffledDeck(this.rng));
    this.checkState(s, total);
    let guard = 0;
    while (s.phase !== 'complete') {
      if (++guard > 500) {
        this.fail('hand did not finish within 500 actions');
        return;
      }
      const seat = s.toAct!;
      this.probeIllegal(s, seat);
      const action = this.chaosAction(s);
      s = applyAction(s, seat, action);
      this.report.actions++;
      this.checkState(s, total);
    }
    this.checkResult(s, total);
    for (const p of s.players) this.seats[p.seat]!.stack = p.stack;
  }

  private checkPlan(bb: number, sb: number | null, btn: number, dealt: number[]): void {
    if (!dealt.includes(bb)) this.fail('big blind not dealt in');
    if (sb !== null && !dealt.includes(sb)) this.fail('small blind not dealt in');
    if (dealt.length > 2 && (btn === bb || btn === sb)) this.fail('button is also a blind');
    if (dealt.length === 2 && btn !== sb) this.fail('heads-up button is not the small blind');
  }

  private chaosAction(s: HandState): PlayerAction {
    const legal = legalActions(s)!;
    const r = this.rng.float();
    const raise = (): PlayerAction => {
      const k = this.rng.float();
      const to =
        k < 0.35 ? legal.minTo
        : k < 0.5 ? legal.maxTo
        : legal.minTo + this.rng.int(legal.maxTo - legal.minTo + 1);
      return { type: legal.isBet ? 'bet' : 'raise', to };
    };
    if (legal.canCheck) {
      if (r < 0.55) return { type: 'check' };
      if (r < 0.9 && legal.canRaise) return raise();
      if (r < 0.97) return { type: 'allin' };
      return { type: 'fold' };
    }
    if (r < 0.3) return { type: 'fold' };
    if (r < 0.7) return { type: 'call' };
    if (r < 0.9 && legal.canRaise) return raise();
    return { type: 'allin' };
  }

  /** Tries a few illegal actions and checks they are rejected. */
  private probeIllegal(s: HandState, seat: number): void {
    if (this.rng.float() > 0.1) return;
    const legal = legalActions(s)!;
    const attempts: Array<[number, PlayerAction]> = [];
    const other = s.players.find((p) => p.seat !== seat && !p.folded && !p.allIn);
    if (other) attempts.push([other.seat, { type: 'call' }]);
    if (!legal.canCheck) attempts.push([seat, { type: 'check' }]);
    if (legal.canRaise && legal.minTo < legal.maxTo && legal.minTo - 1 > s.currentBet) {
      attempts.push([seat, { type: 'raise', to: legal.minTo - 1 }]);
    }
    if (legal.canRaise) attempts.push([seat, { type: 'raise', to: legal.maxTo + 1 }]);
    if (!legal.canRaise) attempts.push([seat, { type: 'raise', to: s.currentBet + 10 * s.config.bigBlind }]);
    for (const [who, action] of attempts) {
      try {
        applyAction(s, who, action);
        this.fail(`illegal action accepted: seat ${who} ${JSON.stringify(action)}`);
      } catch (e) {
        if (e instanceof IllegalActionError) this.report.illegalAttemptsRejected++;
        else this.fail(`unexpected error type: ${(e as Error).message}`);
      }
    }
  }

  private checkState(s: HandState, total: number): void {
    const sum = s.players.reduce((a, p) => a + p.stack + p.totalCommitted, 0);
    if (s.phase !== 'complete' && sum !== total) this.fail(`chips not conserved: ${sum} vs ${total}`);
    for (const p of s.players) {
      if (p.stack < 0 || p.committed < 0 || p.totalCommitted < 0) this.fail(`negative chips for ${p.name}`);
      if (s.phase !== 'complete' && p.committed > s.currentBet && !p.folded) {
        this.fail(`${p.name} committed ${p.committed} above current bet ${s.currentBet}`);
      }
      if (s.phase !== 'complete' && p.allIn && p.stack !== 0) this.fail(`${p.name} all-in with chips behind`);
    }
    if (s.phase !== 'complete') {
      const actor = s.players.find((p) => p.seat === s.toAct);
      if (!actor) this.fail('no player to act in an unfinished hand');
      else if (actor.folded || actor.allIn) this.fail(`actor ${actor.name} cannot act`);
      const legal = legalActions(s)!;
      if (legal.canRaise && legal.minTo > legal.maxTo) this.fail('minTo above maxTo');
      if (legal.canRaise && legal.minTo <= s.currentBet) this.fail('raise not above current bet');
    }
  }

  private checkResult(s: HandState, total: number): void {
    const res = s.result!;
    const final = s.players.reduce((a, p) => a + p.stack, 0);
    if (final + res.rake !== total) this.fail(`final stacks ${final} + rake ${res.rake} != ${total}`);
    const potSum = res.pots.reduce((a, p) => a + p.amount, 0);
    const won = Object.values(res.winnings).reduce((a, b) => a + b, 0);
    if (potSum !== won) this.fail(`pots ${potSum} != winnings ${won}`);
    const netSum = Object.values(res.net).reduce((a, b) => a + b, 0);
    if (netSum !== -res.rake) this.fail(`net results sum to ${netSum}, expected ${-res.rake}`);
    if (res.rake > 0) this.report.rakedHands++;
    if (res.pots.length > 1) this.report.sidePotHands++;
    if (s.ranOut) this.report.allInRunouts++;
    for (const p of s.players) {
      if (p.folded && (res.winnings[p.seat] ?? 0) > 0) this.fail(`folded player ${p.name} won chips`);
    }
    if (!res.wentToShowdown) return;
    this.report.showdowns++;
    if (s.board.length !== 5) this.fail('showdown without a full board');
    // Independently check every contested pot's winners.
    const awards = s.events.filter((e) => e.type === 'award');
    res.pots.forEach((pot, i) => {
      let contenders = pot.eligible.filter((seat) => !s.players.find((p) => p.seat === seat)!.mucked);
      if (contenders.length === 0) contenders = pot.eligible; // uncontested side pot
      const vals = new Map(
        contenders.map((seat) => [seat, referenceEvaluate([...s.players.find((p) => p.seat === seat)!.hole, ...s.board])]),
      );
      const best = Math.max(...vals.values());
      const expected = contenders.filter((x) => vals.get(x) === best).sort();
      const got = awards.filter((a) => a.type === 'award' && a.potIndex === i).map((a) => a.seat).sort();
      if (pot.amount > 0 && JSON.stringify(expected) !== JSON.stringify(got)) {
        this.fail(`pot ${i} went to ${got} but best hand(s) were ${expected}`);
      }
      if (got.length > 1) this.report.splitPots++;
      // A mucked hand must not have been able to win this pot.
      for (const seat of pot.eligible) {
        const p = s.players.find((x) => x.seat === seat)!;
        if (p.mucked && pot.eligible.length >= 2) {
          const v = referenceEvaluate([...p.hole, ...s.board]);
          if (v >= best) this.fail(`${p.name} mucked a hand that would have won or tied pot ${i}`);
        }
      }
    });
  }
}

export function runSimulation(hands: number, seed?: number): SimReport {
  const sim = new Simulator(seed);
  sim.runBatch(hands);
  return sim.report;
}
