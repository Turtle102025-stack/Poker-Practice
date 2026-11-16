import { describe, expect, it } from 'vitest';
import { act, makeHand } from '../engine/testUtils';
import { toCsv, toXlsx } from './files';
import { easternTime, toPokerStars } from './pokerstars';
import { makeRecord, type HandRecord } from './record';
import { actionRows, buildSheets, handRow, playerRows } from './sheets';
import { simulateRecords } from './testData';

const T = Date.UTC(2026, 10, 16, 14, 5, 33); // 9:05:33 ET

function record(s: ReturnType<typeof makeHand>, heroSeat = 0, practiceMode = false): HandRecord {
  return makeRecord(s, {
    id: 1000, sessionId: 's1', stakeId: '1-3', stakesLabel: '$1/$3', tableName: "$1/$3 No-Limit Hold'em",
    heroSeat, practiceMode, endedAt: T,
  });
}

describe('PokerStars text', () => {
  it('formats Eastern time like PokerStars', () => {
    expect(easternTime(T)).toBe('2026/11/16 9:05:33 ET');
    expect(easternTime(Date.UTC(2026, 6, 4, 4, 0, 9))).toBe('2026/07/04 0:00:09 ET'); // summer time, midnight
  });

  it('writes a complete hand with raises, an uncalled bet and no showdown', () => {
    let s = makeHand({
      stacks: { 0: 300, 1: 300, 2: 300 }, button: 0, sb: 1, bb: 2,
      holes: { 0: 'Ah Kd', 1: '7c 2d', 2: 'Qs Qh' }, board: 'Kh 7s 2c 9d 3s',
    });
    s = act(s, 'r15', 'c', 'c', 'x', 'b20', 'r60', 'f', 'c', 'x', 'b100', 'f');
    expect(toPokerStars(record(s))).toBe([
      "PokerStars Hand #1000:  Hold'em No Limit ($1/$3 USD) - 2026/11/16 9:05:33 ET",
      "Table 'Practice 1-3' 10-max Seat #1 is the button",
      'Seat 1: Hero ($300 in chips)',
      'Seat 2: P1 ($300 in chips)',
      'Seat 3: P2 ($300 in chips)',
      'P1: posts small blind $1',
      'P2: posts big blind $3',
      '*** HOLE CARDS ***',
      'Dealt to Hero [Ah Kd]',
      'Hero: raises $12 to $15',
      'P1: calls $14',
      'P2: calls $12',
      '*** FLOP *** [Kh 7s 2c]',
      'P1: checks',
      'P2: bets $20',
      'Hero: raises $40 to $60',
      'P1: folds',
      'P2: calls $40',
      '*** TURN *** [Kh 7s 2c] [9d]',
      'P2: checks',
      'Hero: bets $100',
      'P2: folds',
      'Uncalled bet ($100) returned to Hero',
      'Hero collected $165 from pot',
      "Hero: doesn't show hand",
      '*** SUMMARY ***',
      'Total pot $165 | Rake $0',
      'Board [Kh 7s 2c 9d]',
      'Seat 1: Hero (button) collected ($165)',
      'Seat 2: P1 (small blind) folded on the Flop',
      'Seat 3: P2 (big blind) folded on the Turn',
    ].join('\n'));
  });

  it('writes showdowns, side pots, mucks and preflop folds', () => {
    let s = makeHand({
      stacks: { 0: 300, 1: 50, 2: 150, 3: 400 }, button: 0, sb: 1, bb: 2, blinds: [5, 10],
      holes: { 1: 'Ac Ad', 2: 'Kc Kd', 0: 'Qc Qd', 3: '7h 2s' }, board: '2c 9h 7d Js 3c',
    });
    s = act(s, 'f', 'a', 'a', 'a'); // UTG folds, BTN shoves, SB and BB call all-in
    const text = toPokerStars(record(s, 0));
    expect(text).toContain('P3: folds');
    expect(text).toContain('Hero: raises $290 to $300 and is all-in');
    expect(text).toContain('P1: calls $45 and is all-in');
    expect(text).toContain('Uncalled bet ($150) returned to Hero');
    expect(text).toContain('*** SHOW DOWN ***');
    expect(text).toContain('P1: shows [Ac Ad] (a pair of Aces)');
    expect(text).toContain('P1 collected $150 from main pot');
    expect(text).toContain('P2 collected $200 from side pot-1');
    expect(text).toContain('Total pot $350 Main pot $150. Side pot-1 $200. | Rake $0');
    expect(text).toContain('Seat 2: P1 (small blind) showed [Ac Ad] and won ($150) with a pair of Aces');
    expect(text).toContain('Seat 1: Hero (button) showed [Qc Qd] and lost with a pair of Queens');
    expect(text).toContain("Seat 4: P3 folded before Flop (didn't bet)");
  });

  it('mucked hands stay hidden unless you ask for everyone’s cards in practice mode', () => {
    let s = makeHand({
      stacks: { 0: 300, 1: 300 }, button: 0, sb: 0, bb: 1,
      holes: { 1: 'Ac Ad', 0: 'Kc Kd' }, board: '2s 7h 9c 4d Js',
    });
    s = act(s, 'c', 'x', 'x', 'x', 'x', 'x', 'b10', 'c');
    const strict = toPokerStars(record(s, 1, true));
    expect(strict).toContain('P0: mucks hand');
    expect(strict).toContain('Seat 1: P0 (button) (small blind) mucked\n');
    expect(strict).not.toContain('Dealt to P0');
    const all = toPokerStars(record(s, 1, true), { allHoleCards: true });
    expect(all).toContain('Dealt to P0 [Kc Kd]');
    expect(all).toContain('mucked [Kc Kd]');
  });
});

describe('spreadsheet rows', () => {
  it('records every bet size, facing amount, pot and stack; a pot-sized raise is 100%', () => {
    let s = makeHand({ stacks: { 0: 300, 1: 300, 2: 300 }, button: 0, sb: 1, bb: 2 });
    s = act(s, 'r10', 'f', 'r33', 'f'); // BTN pot-raise to 10; BB pot-raises to 33 (call 7, pot 18, raise 23... )
    const rows = actionRows(record(s));
    const open = rows.find((r) => r.player === 'Hero' && r.action === 'raise')!;
    expect(open).toMatchObject({ amount: 10, to: 10, facing: 3, potBefore: 4, potAfter: 14, stackBefore: 300, stackAfter: 290, pctPot: 1 });
    const threeBet = rows.find((r) => r.player === 'P2' && r.action === 'raise')!;
    // BB faces 7 more; pot after calling = 14 + 7 = 21; raise of 23 over the call = 110%
    expect(threeBet).toMatchObject({ amount: 30, to: 33, facing: 7, potBefore: 14, potAfter: 44 });
    expect(threeBet.pctPot).toBeCloseTo(23 / 21, 3);
    expect(rows.find((r) => r.action === 'uncalled bet returned')).toMatchObject({ player: 'P2', amount: 23 });
    expect(rows.every((r) => r.handId === 1000)).toBe(true);
    expect(rows.map((r) => r.n)).toEqual(rows.map((_, i) => i + 1));
  });

  it('reconciles over 400 realistic hands: actions add up to the pot, and results add up', () => {
    const recs = simulateRecords(400, 3);
    let sidePots = 0, straddles = 0, uncalled = 0;
    for (const rec of recs) {
      const hand = handRow(rec);
      const actions = actionRows(rec);
      const players = playerRows(rec, { includeStyles: true });
      const put = actions.filter((a) => a.action !== 'uncalled bet returned').reduce((s, a) => s + (a.amount as number), 0);
      const back = actions.filter((a) => a.action === 'uncalled bet returned').reduce((s, a) => s + (a.amount as number), 0);
      expect(put - back).toBe(hand.finalPot);
      expect(actions[actions.length - 1].potAfter).toBe(hand.finalPot);
      // Each player's net = what they won - what they put in.
      for (const p of players) {
        const mine = actions.filter((a) => a.seat === p.seat);
        const paid = mine.filter((a) => a.action !== 'uncalled bet returned').reduce((s, a) => s + (a.amount as number), 0)
          - mine.filter((a) => a.action === 'uncalled bet returned').reduce((s, a) => s + (a.amount as number), 0);
        const won = rec.hand.events.filter((e) => e.type === 'award' && e.seat === (p.seat as number) - 1).reduce((s, e) => s + (e.type === 'award' ? e.amount : 0), 0);
        expect(p.net).toBe(won - paid);
      }
      const hero = players.find((p) => p.name === 'Hero')!;
      expect(hand.myNet).toBe(hero.net);
      expect(players.reduce((s, p) => s + (p.net as number), 0) + (hand.rake as number)).toBe(0);
      if (rec.hand.result!.pots.length > 1) sidePots++;
      if (hand.straddle) straddles++;
      if (actions.some((a) => a.action === 'uncalled bet returned')) uncalled++;
      // Practice mode: everyone's hole cards are in the Players sheet.
      expect(players.every((p) => (p.holeCards as string).length === 5)).toBe(true);
    }
    expect(sidePots).toBeGreaterThan(0);
    expect(straddles).toBeGreaterThan(10);
    expect(uncalled).toBeGreaterThan(100);
  });

  it('hides unshown hole cards outside practice mode', () => {
    const recs = simulateRecords(60, 5, 0, false);
    for (const rec of recs) {
      for (const p of playerRows(rec, { includeStyles: false })) {
        const visible = p.name === 'Hero' || p.shown;
        expect(Boolean(p.holeCards)).toBe(visible);
        expect(p).not.toHaveProperty('trueStyle');
      }
    }
  });
});

describe('files', () => {
  it('CSV quotes commas, quotes and line breaks', () => {
    const csv = toCsv({
      name: 'T',
      columns: [{ key: 'a', header: 'A', type: 'text', width: 5 }, { key: 'b', header: 'B', type: 'pct', width: 5 }],
      rows: [{ a: 'Walt $120 (main pot); Hero, "the" man', b: 0.333 }],
    });
    expect(csv).toBe('A,B (%)\r\n"Walt $120 (main pot); Hero, ""the"" man",33.3\r\n');
  });

  it('.xlsx has the three sheets plus notes, with every row', async () => {
    const recs = simulateRecords(50, 9);
    const sheets = buildSheets(recs, { includeStyles: true, labelFor: (id) => (id === recs[0].hand.players[1].id ? 'Nit' : undefined) });
    const buf = await toXlsx(sheets);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Hands', 'Actions', 'Players', 'Notes']);
    expect(wb.getWorksheet('Hands')!.rowCount).toBe(51);
    expect(wb.getWorksheet('Actions')!.rowCount).toBe(sheets[1].rows.length + 1);
    expect(wb.getWorksheet('Players')!.rowCount).toBe(sheets[2].rows.length + 1);
    const actions = wb.getWorksheet('Actions')!;
    expect(actions.getRow(1).getCell(10).value).toBe('Amount added');
    expect(actions.getColumn(10).numFmt).toContain('$');
    const players = wb.getWorksheet('Players')!;
    const headers = (players.getRow(1).values as unknown[]).slice(1);
    expect(headers).toContain('My label');
    expect(headers).toContain('True style');
  });
});
