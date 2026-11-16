import { describe, expect, it } from 'vitest';
import { seededRng } from '../engine/rng';
import { act, makeHand } from '../engine/testUtils';
import { getPlayerView } from '../engine/view';
import { Seating } from '../table/seating';
import { STAKES } from '../table/stakes';
import { STYLES, type Archetype } from './archetypes';
import { applyTilt, decide } from './brain';
import { runCalibration, TARGETS } from './calibrate';
import { AiDirector } from './director';
import { ROSTER, ROSTER_BY_ID, personalStyle } from './roster';

describe('roster', () => {
  it('has 50 players in the requested mix', () => {
    const count = (a: Archetype) => ROSTER.filter((p) => p.archetype === a).length;
    expect(ROSTER).toHaveLength(50);
    expect([count('nit'), count('semiNit'), count('tightPassive'), count('loosePassive'),
      count('looseAggressive'), count('aggroReg'), count('goodReg'), count('shortStacker')])
      .toEqual([6, 6, 6, 9, 7, 5, 5, 6]);
    expect(new Set(ROSTER.map((p) => p.id)).size).toBe(50);
    expect(new Set(ROSTER.map((p) => p.name)).size).toBe(50);
    for (const p of ROSTER) expect(p.description.length).toBeGreaterThan(30);
  });

  it('each player is a stable variation of their style', () => {
    const a = personalStyle(ROSTER_BY_ID.get('bigmike')!);
    const b = personalStyle(ROSTER_BY_ID.get('bigmike')!);
    const c = personalStyle(ROSTER_BY_ID.get('hector')!);
    expect(a).toEqual(b);
    expect(a.callOpen).not.toBe(c.callOpen);
    expect(Math.abs(a.callOpen / STYLES.loosePassive.callOpen - 1)).toBeLessThanOrEqual(0.15);
  });
});

describe('no peeking', () => {
  it('decisions depend only on what the player can see', () => {
    // Seat 1 decides on the flop. Its own cards and the board are the same in both
    // hands; the opponents hold completely different cards.
    const board = '9c 8d 2h Kd 5s';
    for (const mine of ['Ac Ks', 'Qs Qh', '7c 2d', 'Jh Th']) {
      for (const id of ['tyler', 'harold', 'nadia', 'bigmike']) {
        const make = (others: Record<number, string>) =>
          act(
            makeHand({ stacks: { 0: 300, 1: 300, 2: 300, 3: 300 }, button: 0, sb: 1, bb: 2, holes: { 1: mine, ...others }, board }),
            'c', 'r12', 'c', 'c', 'c',
          );
        const a = make({ 0: 'As Ad', 2: 'Kc Kh', 3: 'Qd Qc' });
        const b = make({ 0: '3s 4d', 2: '6h 5h', 3: '2c 2s' });
        expect(a.toAct).toBe(1);
        expect(b.toAct).toBe(1);
        const style = personalStyle(ROSTER_BY_ID.get(id)!);
        for (const seed of [1, 2, 3, 9]) {
          const da = decide(getPlayerView(a, 1), { params: style, tilt: 0, rng: seededRng(seed) });
          const db = decide(getPlayerView(b, 1), { params: style, tilt: 0, rng: seededRng(seed) });
          expect(da).toEqual(db);
        }
      }
    }
  });
});

describe('tilt', () => {
  it('loosens a player up and fades over time', () => {
    const lag = STYLES.looseAggressive;
    const tilted = applyTilt(lag, 0.8);
    expect(tilted.callOpen).toBeGreaterThan(lag.callOpen);
    expect(tilted.bluff).toBeGreaterThan(lag.bluff);
    expect(tilted.callThreshold).toBeLessThan(lag.callThreshold);

    const director = new AiDirector(new Seating(STAKES[0], seededRng(1)), seededRng(2));
    // Ronnie (loose aggressive) and Harold (nit) both lose a $250 pot at $1/$3.
    let s = makeHand({ stacks: { 0: 300, 1: 300, 2: 600 }, button: 0, sb: 1, bb: 2, holes: { 0: 'Kc Kd', 1: 'Qc Qd', 2: 'Ac Ad' }, board: '2s 7h 9c 4d 3s' });
    s = { ...s, players: s.players.map((p) => ({ ...p, id: p.seat === 0 ? 'ronnie' : p.seat === 1 ? 'harold' : 'sam' })) };
    s = act(s, 'r250', 'c', 'a', 'c', 'c');
    expect(s.phase).toBe('complete');
    director.afterHand(s);
    const ronnie = director.tiltOf('ronnie');
    const harold = director.tiltOf('harold');
    expect(ronnie).toBeGreaterThan(0.4);
    expect(harold).toBeLessThan(0.15);
    for (let i = 0; i < 15; i++) director.afterHand({ ...s, players: [], events: [] });
    expect(director.tiltOf('ronnie')).toBeLessThan(ronnie * 0.2);
  });
});

describe('seating', () => {
  it('fills 6 to 9 seats around you', () => {
    for (let seed = 1; seed < 20; seed++) {
      const seating = new Seating(STAKES[0], seededRng(seed));
      const seats = Array.from({ length: 10 }, () => null) as Parameters<Seating['initialFill']>[0];
      seats[4] = { seat: 4, id: 'hero', name: 'You', stack: 300, status: 'active', isHero: true };
      const filled = seating.initialFill(seats).filter((o) => o && !o.isHero).length;
      expect(filled).toBeGreaterThanOrEqual(6);
      expect(filled).toBeLessThanOrEqual(9);
    }
  });

  it('low stakes draw mostly recreational players and short stackers; high stakes draw mostly regulars', () => {
    const share = (stakeIndex: number, kinds: Archetype[]) => {
      const seating = new Seating(STAKES[stakeIndex], seededRng(5));
      let hit = 0;
      for (let i = 0; i < 3000; i++) if (kinds.includes(seating.pickPlayer(new Set(), 0)!.archetype)) hit++;
      return hit / 3000;
    };
    const recs: Archetype[] = ['loosePassive', 'looseAggressive', 'shortStacker'];
    const regs: Archetype[] = ['goodReg', 'aggroReg'];
    expect(share(0, recs)).toBeGreaterThan(0.45);
    expect(share(0, regs)).toBeLessThan(0.1);
    expect(share(4, regs)).toBeGreaterThan(0.3);
    expect(share(4, ['shortStacker'])).toBeLessThan(0.03);
  });

  it('buy-ins follow each player’s habit and the table limits', () => {
    const seating = new Seating(STAKES[0], seededRng(3));
    expect(seating.buyInFor(ROSTER_BY_ID.get('eddie')!)).toBe(100); // short stacker: minimum
    expect(seating.buyInFor(ROSTER_BY_ID.get('nadia')!)).toBe(500); // max
    const deep = new Seating(STAKES[3], seededRng(3)).buyInFor(ROSTER_BY_ID.get('jasmine')!);
    expect(deep).toBeGreaterThanOrEqual(300 * 20); // no-max table: deep buy-in
    for (const p of ROSTER) {
      const amt = seating.buyInFor(p);
      expect(amt).toBeGreaterThanOrEqual(100);
      expect(amt).toBeLessThanOrEqual(500);
    }
  });

  it('players come and go between hands', () => {
    const seating = new Seating(STAKES[0], seededRng(11));
    let seats = Array.from({ length: 10 }, () => null) as Parameters<Seating['initialFill']>[0];
    seats[0] = { seat: 0, id: 'hero', name: 'You', stack: 300, status: 'active', isHero: true };
    seats = seating.initialFill(seats);
    const start = new Set(seats.filter((o) => o && !o.isHero).map((o) => o!.id));
    const notices: string[] = [];
    for (let h = 1; h <= 300; h++) {
      const r = seating.betweenHands(seats, { handNo: h, tilt: () => 0 });
      seats = r.seats;
      notices.push(...r.notices);
      expect(seats[0]?.isHero).toBe(true);
    }
    const now = new Set(seats.filter((o) => o && !o.isHero).map((o) => o!.id));
    expect([...now].filter((id) => !start.has(id)).length).toBeGreaterThan(0);
    expect(notices.some((n) => n.includes('sits down'))).toBe(true);
    expect(notices.some((n) => n.includes('leaves'))).toBe(true);
  });
});

describe('calibration: styles play like their descriptions', () => {
  const report = runCalibration({ hands: 12_000, seed: 77 });
  const r = (a: Archetype) => report.find((x) => x.archetype === a)!;

  it('VPIP and PFR are within each style’s target range', () => {
    for (const row of report) {
      const t = TARGETS[row.archetype];
      expect(row.vpip!, `${row.archetype} VPIP`).toBeGreaterThanOrEqual(t.vpip[0] - 0.02);
      expect(row.vpip!, `${row.archetype} VPIP`).toBeLessThanOrEqual(t.vpip[1] + 0.02);
      expect(row.pfr!, `${row.archetype} PFR`).toBeGreaterThanOrEqual(t.pfr[0] - 0.02);
      expect(row.pfr!, `${row.archetype} PFR`).toBeLessThanOrEqual(t.pfr[1] + 0.02);
    }
  });

  it('tight players play fewer hands than loose players', () => {
    expect(r('nit').vpip!).toBeLessThan(r('semiNit').vpip!);
    expect(r('semiNit').vpip!).toBeLessThan(r('goodReg').vpip!);
    expect(r('goodReg').vpip!).toBeLessThan(r('loosePassive').vpip!);
    expect(r('goodReg').vpip!).toBeLessThan(r('looseAggressive').vpip!);
  });

  it('passive players limp and call; aggressive players raise and bet', () => {
    expect(r('loosePassive').limp!).toBeGreaterThan(0.15);
    expect(r('goodReg').limp!).toBeLessThan(0.02);
    expect(r('loosePassive').af!).toBeLessThan(1);
    expect(r('tightPassive').af!).toBeLessThan(1);
    expect(r('aggroReg').af!).toBeGreaterThan(2);
    expect(r('aggroReg').threeBet!).toBeGreaterThan(r('goodReg').threeBet!);
    expect(r('goodReg').threeBet!).toBeGreaterThan(r('nit').threeBet!);
    expect(r('tightPassive').cbet!).toBeLessThan(r('goodReg').cbet!);
  });

  it('calling stations fold less than nits', () => {
    expect(r('loosePassive').foldToCbet!).toBeLessThan(r('nit').foldToCbet! - 0.1);
    expect(r('looseAggressive').foldToCbet!).toBeLessThan(r('nit').foldToCbet!);
  });

  it('recreational players lose and good regulars win over time', () => {
    expect(r('loosePassive').bbPer100).toBeLessThan(0);
    expect(r('looseAggressive').bbPer100).toBeLessThan(0);
    expect(r('goodReg').bbPer100).toBeGreaterThan(0);
  });
});
