import type { Rng } from '../engine/rng';
import type { HandState, PlayerAction } from '../engine/types';
import type { PlayerView } from '../engine/view';
import type { Occupant, TableHooks } from '../table/controller';
import type { Seating, SeatingState } from '../table/seating';
import type { StyleParams } from './archetypes';
import { decide } from './brain';
import { PublicStats, type StatCounts } from './publicStats';
import { personalStyle, ROSTER_BY_ID } from './roster';

/**
 * Runs the computer players at one table: their decisions, their tilt, the
 * public stats everyone can observe, and the comings and goings of players.
 */

/** Lines for players who just lost a big pot (visible tilt). */
const TELLS = [
  '{name} slams a fist on the rail.',
  '{name} mutters something about the river.',
  '{name} orders another drink.',
  '{name} stares at the board in disbelief.',
  '{name} stacks the remaining chips a little too hard.',
  '{name} says, "Unbelievable. Every time."',
  '{name} goes quiet and glares at the dealer.',
];

export interface DirectorState {
  tilt: Array<[string, number]>;
  stats: Array<[string, StatCounts]>;
  seating: SeatingState;
}

export class AiDirector implements TableHooks {
  readonly stats = new PublicStats();
  private tilt = new Map<string, number>();
  private styles = new Map<string, StyleParams>();

  constructor(
    readonly seating: Seating,
    private readonly rng: Rng,
  ) {}

  exportState(): DirectorState {
    return { tilt: [...this.tilt], stats: [...this.stats.counts], seating: this.seating.exportState() };
  }

  importState(s: DirectorState): void {
    this.tilt = new Map(s.tilt);
    this.stats.counts.clear();
    for (const [id, c] of s.stats) this.stats.counts.set(id, { ...c });
    this.seating.importState(s.seating);
  }

  style(id: string): StyleParams {
    let s = this.styles.get(id);
    if (!s) {
      const player = ROSTER_BY_ID.get(id);
      if (!player) throw new Error(`Unknown player ${id}`);
      s = personalStyle(player);
      this.styles.set(id, s);
    }
    return s;
  }

  tiltOf = (id: string): number => this.tilt.get(id) ?? 0;

  decide(occ: Occupant, view: PlayerView): PlayerAction {
    return decide(view, {
      params: this.style(occ.id),
      tilt: this.tiltOf(occ.id),
      rng: this.rng,
      stats: (id) => this.stats.get(id),
    });
  }

  wantsStraddle(occ: Occupant): boolean {
    return this.rng.float() < this.style(occ.id).straddle * (1 + this.tiltOf(occ.id));
  }

  betweenHands(seats: Array<Occupant | null>, handNo: number) {
    return this.seating.betweenHands(seats, { handNo, tilt: this.tiltOf });
  }

  afterHand(hand: HandState): string[] {
    this.stats.record(hand);
    const notes: string[] = [];
    // Tilt fades over roughly 10-20 hands.
    for (const [id, t] of this.tilt) {
      const next = t * 0.88;
      if (next < 0.02) this.tilt.delete(id);
      else this.tilt.set(id, next);
    }
    const bb = hand.config.bigBlind;
    for (const p of hand.players) {
      if (!ROSTER_BY_ID.has(p.id)) continue;
      const net = hand.result?.net[p.seat] ?? 0;
      const lostBig = net <= -40 * bb || (net < -20 * bb && -net >= 0.5 * p.startStack);
      if (!lostBig) continue;
      const sens = this.style(p.id).tiltSensitivity;
      const add = sens * Math.min(1, -net / (100 * bb)) * 1.2;
      const t = Math.min(1, this.tiltOf(p.id) + add);
      this.tilt.set(p.id, t);
      if (add > 0.2 && this.rng.float() < 0.75) {
        notes.push(TELLS[this.rng.int(TELLS.length)].replace('{name}', p.name));
      }
    }
    return notes;
  }
}
