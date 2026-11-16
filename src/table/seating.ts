import { REBUY_CHANCE, STAKE_PREFERENCE, STYLES } from '../ai/archetypes';
import { ROSTER, type RosterPlayer } from '../ai/roster';
import { niceAmount } from '../ai/sizing';
import type { Rng } from '../engine/rng';
import type { Occupant } from './controller';
import { typicalMax, type Stake } from './stakes';

/**
 * Who sits at the table. Players are drawn from the 50-player pool, weighted
 * toward the stakes they like. Between hands, busted players rebuy or leave,
 * some players top up, others cash out and go home, and new players sit down
 * and either wait for the big blind or post to come in.
 */
export interface SeatingContext {
  handNo: number;
  /** Current tilt of a player (0..1). */
  tilt: (playerId: string) => number;
}

export interface ChurnResult {
  seats: Array<Occupant | null>;
  notices: string[];
}

/** How quickly empty seats fill at each stake ($1/$3 has a waiting list; $50/$100 doesn't). */
const FILL_RATE = [1, 0.9, 0.75, 0.65, 0.55];
const RETURN_COOLDOWN_HANDS = 150;

export class Seating {
  private cooldown = new Map<string, number>();
  /** Hand number each player sat down, and how much they have bought in for this session. */
  private sessions = new Map<string, { since: number; boughtIn: number }>();

  constructor(
    readonly stake: Stake,
    private readonly rng: Rng,
    private readonly roster: RosterPlayer[] = ROSTER,
  ) {}

  /** Buy-in amount for a player at these stakes, by their habit. */
  buyInFor(p: RosterPlayer): number {
    const { minBuyIn, bigBlind } = this.stake;
    const max = typicalMax(this.stake);
    let amount: number;
    switch (p.buyIn) {
      case 'min': amount = minBuyIn; break;
      case 'max': amount = max; break;
      case 'deep': amount = this.stake.maxBuyIn ?? (300 + this.rng.int(101)) * bigBlind; break;
      case 'mid': amount = (minBuyIn + max) / 2; break;
      default: amount = minBuyIn + this.rng.float() * (max - minBuyIn);
    }
    return Math.max(minBuyIn, Math.min(this.stake.maxBuyIn ?? Infinity, niceAmount(amount, bigBlind)));
  }

  /** Picks someone from the pool who likes these stakes and isn't seated or on a break. */
  pickPlayer(exclude: Set<string>, handNo: number): RosterPlayer | null {
    const candidates = this.roster.filter(
      (p) => !exclude.has(p.id) && (this.cooldown.get(p.id) ?? -Infinity) <= handNo,
    );
    if (candidates.length === 0) return null;
    const weights = candidates.map(
      (p) => STAKE_PREFERENCE[p.archetype][this.stake.index] * (p.stakeBias?.[this.stake.index] ?? 1),
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.rng.float() * total;
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  private occupantFor(p: RosterPlayer, seat: number, handNo: number, status: Occupant['status']): Occupant {
    const stack = this.buyInFor(p);
    this.sessions.set(p.id, { since: handNo, boughtIn: stack });
    return { seat, id: p.id, name: p.name, stack, status, isHero: false };
  }

  /** Seats 6 to 9 players (as many as fit) around you when you sit down. */
  initialFill(seats: Array<Occupant | null>, handNo = 0): Array<Occupant | null> {
    const out = seats.slice();
    const empty = out.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);
    const want = Math.min(empty.length, 6 + this.rng.int(4));
    const taken = new Set(out.filter((o): o is Occupant => !!o).map((o) => o.id));
    for (let k = 0; k < want; k++) {
      const idx = this.rng.int(empty.length);
      const seat = empty.splice(idx, 1)[0];
      const p = this.pickPlayer(taken, handNo);
      if (!p) break;
      taken.add(p.id);
      out[seat] = this.occupantFor(p, seat, handNo, 'active');
    }
    return out;
  }

  /** Rebuys, top-ups, departures and arrivals between hands. */
  betweenHands(seats: Array<Occupant | null>, ctx: SeatingContext): ChurnResult {
    const out = seats.slice();
    const notices: string[] = [];
    const byId = new Map(this.roster.map((p) => [p.id, p]));

    for (let i = 0; i < out.length; i++) {
      const o = out[i];
      if (!o || o.isHero) continue;
      const p = byId.get(o.id);
      if (!p) continue;
      const tilt = ctx.tilt(p.id);
      const session = this.sessions.get(p.id) ?? { since: ctx.handNo, boughtIn: o.stack };
      const played = ctx.handNo - session.since;

      if (o.stack === 0) {
        if (this.rng.float() < Math.min(0.97, REBUY_CHANCE[p.archetype] + 0.15 * tilt)) {
          const amount = this.buyInFor(p);
          out[i] = { ...o, stack: amount };
          session.boughtIn += amount;
          this.sessions.set(p.id, session);
          notices.push(`${p.name} rebuys for $${amount.toLocaleString('en-US')}.`);
        } else {
          out[i] = null;
          this.leave(p, ctx.handNo);
          notices.push(`${p.name} is out of chips and leaves the table.`);
        }
        continue;
      }

      let leave = 1 / p.sessionHands;
      if (played > p.sessionHands) leave *= 2.5;
      if (o.stack > 2.5 * session.boughtIn) leave *= 2;
      if (tilt > 0.3) leave *= 0.5;
      if (p.archetype === 'shortStacker' && o.stack >= 3 * this.stake.minBuyIn) leave += 0.06;
      if (this.rng.float() < leave) {
        out[i] = null;
        this.leave(p, ctx.handNo);
        const net = o.stack - session.boughtIn;
        const how = net > 0 ? `up $${net.toLocaleString('en-US')}` : net < 0 ? `down $${(-net).toLocaleString('en-US')}` : 'even';
        notices.push(`${p.name} racks up $${o.stack.toLocaleString('en-US')} and leaves (${how}).`);
        continue;
      }

      // Players who like a full stack top back up.
      const target = p.buyIn === 'max' || p.buyIn === 'deep' ? this.buyInFor(p) : 0;
      if (target > 0 && o.stack < 0.55 * target && this.rng.float() < 0.3) {
        out[i] = { ...o, stack: target };
        session.boughtIn += target - o.stack;
        this.sessions.set(p.id, session);
        notices.push(`${p.name} tops up to $${target.toLocaleString('en-US')}.`);
      }
    }

    // New arrivals.
    const empty = out.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);
    const seated = out.filter((o): o is Occupant => !!o);
    if (empty.length > 0) {
      const short = seated.length < 5;
      const chance = (short ? 0.6 : 0.06 + 0.07 * empty.length) * FILL_RATE[this.stake.index];
      const arrivals = short && this.rng.float() < 0.5 ? 2 : 1;
      for (let k = 0; k < arrivals && empty.length > 0; k++) {
        if (this.rng.float() >= chance) continue;
        const seat = empty.splice(this.rng.int(empty.length), 1)[0];
        const p = this.pickPlayer(new Set(out.filter((o): o is Occupant => !!o).map((o) => o.id)), ctx.handNo);
        if (!p) break;
        const posts = this.rng.float() < STYLES[p.archetype].postToEnter;
        const occ = this.occupantFor(p, seat, ctx.handNo, posts ? 'postToEnter' : 'waitingForBB');
        out[seat] = occ;
        notices.push(
          `${p.name} sits down in seat ${seat + 1} with $${occ.stack.toLocaleString('en-US')} ` +
            `(${posts ? 'posting to come in' : 'waiting for the big blind'}).`,
        );
      }
    }
    return { seats: out, notices };
  }

  private leave(p: RosterPlayer, handNo: number): void {
    this.sessions.delete(p.id);
    this.cooldown.set(p.id, handNo + RETURN_COOLDOWN_HANDS);
  }
}
