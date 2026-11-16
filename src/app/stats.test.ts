import { describe, expect, it } from 'vitest';
import { simulateRecords } from '../history/testData';
import { computeStats, heroPreflop } from './stats';

describe('your stats', () => {
  const hands = [...simulateRecords(150, 4, 0), ...simulateRecords(80, 6, 1).map((r) => ({ ...r, id: r.id + 1000, sessionId: 's2' }))];
  const stats = computeStats(hands, [
    { id: 'test-session', stakeId: '1-3', startedAt: 0, endedAt: 1, boughtIn: 300, cashedOut: 250, hands: 150 },
    { id: 's2', stakeId: '2-5', startedAt: 2, endedAt: 3, boughtIn: 500, cashedOut: 600, hands: 80 },
  ], [
    { id: 2, ts: 20, bankroll: 1700, onTable: 310, reason: 'hand' },
    { id: 1, ts: 10, bankroll: 1700, onTable: 300, reason: 'buyin' },
  ]);

  it('counts hands and results overall, by table and by position', () => {
    expect(stats.hands).toBe(230);
    expect(stats.handsNet).toBe(hands.reduce((a, h) => a + h.heroNet, 0));
    expect(stats.byStake.map((s) => [s.key, s.hands, s.sessions])).toEqual([['1-3', 150, 1], ['2-5', 80, 1]]);
    expect(stats.byStake.reduce((a, s) => a + s.net, 0)).toBe(stats.handsNet);
    expect(stats.byPosition.reduce((a, s) => a + s.hands, 0)).toBe(230);
    expect(stats.byPosition[0].key).toBe('UTG');
  });

  it('VPIP and PFR match a direct count; PFR never exceeds VPIP', () => {
    const v = hands.filter((h) => heroPreflop(h).vpip).length / hands.length;
    const p = hands.filter((h) => heroPreflop(h).pfr).length / hands.length;
    expect(stats.vpip).toBeCloseTo(v, 10);
    expect(stats.pfr).toBeCloseTo(p, 10);
    expect(stats.pfr!).toBeLessThanOrEqual(stats.vpip!);
  });

  it('bb/100 uses each table’s big blind', () => {
    const s13 = stats.byStake[0];
    const direct = (hands.slice(0, 150).reduce((a, h) => a + h.heroNet / 3, 0) / 150) * 100;
    expect(s13.bbPer100).toBeCloseTo(direct, 8);
  });

  it('bankroll series is bankroll + chips on the table, in time order', () => {
    expect(stats.series.map((p) => p.total)).toEqual([2000, 2010]);
  });
});
