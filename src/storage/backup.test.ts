import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { simulateRecords } from '../history/testData';
import { checkBackup, makeBackup, restoreBackup } from './backup';
import { PokerDb } from './db';

describe('backup and restore', () => {
  it('round-trips everything', async () => {
    const a = new PokerDb(`backup-a-${Date.now()}`);
    await a.kv.put({ key: 'profile', value: { bankroll: 1234, createdAt: 1, resets: 1 } });
    await a.bankroll.bulkAdd([{ ts: 1, bankroll: 2000, onTable: 0, reason: 'start' }, { ts: 2, bankroll: 1700, onTable: 300, reason: 'buyin' }]);
    await a.sessions.put({ id: 's', stakeId: '1-3', startedAt: 1, endedAt: 2, boughtIn: 300, cashedOut: 250, hands: 3 });
    await a.hands.bulkPut(simulateRecords(20, 2));
    await a.notes.put({ playerId: 'bigmike', label: 'Loose Passive Rec', text: 'station', updatedAt: 5 });
    const backup = JSON.parse(JSON.stringify(await makeBackup(a)));
    expect(checkBackup(backup)).toBeNull();

    const b = new PokerDb(`backup-b-${Date.now()}`);
    await b.kv.put({ key: 'profile', value: { bankroll: 9, createdAt: 9, resets: 0 } });
    await b.notes.put({ playerId: 'harold', label: 'Nit', text: '', updatedAt: 1 });
    expect(await restoreBackup(b, backup)).toEqual({ hands: 20 });
    expect((await b.kv.get('profile'))!.value).toEqual({ bankroll: 1234, createdAt: 1, resets: 1 });
    expect(await b.hands.count()).toBe(20);
    expect(await b.bankroll.count()).toBe(2);
    expect(await b.notes.toArray()).toEqual([{ playerId: 'bigmike', label: 'Loose Passive Rec', text: 'station', updatedAt: 5 }]);
    expect(await b.hands.get(backup.tables.hands[0].id)).toEqual(backup.tables.hands[0]);
  });

  it('rejects files that are not backups', () => {
    expect(checkBackup(null)).toMatch(/not a backup/);
    expect(checkBackup({ app: 'other' })).toMatch(/not a Poker Practice backup/);
    expect(checkBackup({ app: 'poker-practice', version: 2, tables: {} })).toMatch(/newer version/);
    expect(checkBackup({ app: 'poker-practice', version: 1, tables: { kv: [] } })).toMatch(/no bankroll/);
  });
});
