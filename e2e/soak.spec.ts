import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';

/**
 * The "done" check: pick a table, buy in, play hundreds of hands through the
 * real page with no errors, refresh mid-hand, leave with your chips, and export
 * a spreadsheet that shows every bet size and adds up.
 */
const HANDS = Number(process.env.SOAK_HANDS ?? 200);

async function handNo(page: Page): Promise<number> {
  return Number((await page.locator('.table-info').innerText()).match(/#(\d+)/)![1]);
}

async function money(text: string): Promise<number> {
  return Number(text.replace(/[^0-9-]/g, '').replace(/^-/, '-'));
}

test('play hundreds of hands, leave with your chips, export every bet', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('poker-practice.settings.v1')) {
      localStorage.setItem('poker-practice.settings.v1', JSON.stringify({ aiSpeed: 'instant', autoDealMs: 1000, pauseAfterMyShowdown: false, autoFastForward: true }));
    }
  });

  // Lobby and buy-in.
  await page.goto('/');
  await expect(page.locator('.bankroll-amount')).toHaveText('$2,000');
  await expect(page.locator('.table-card.locked')).toHaveCount(1);
  await page.locator('.table-card', { hasText: '$1/$3' }).locator('.sit-btn').click();
  await page.locator('.seat.pick .plate').first().click();
  await page.getByText('Buy in', { exact: true }).click();
  await page.fill('.chips-dialog input[aria-label="Amount"]', '300');
  await page.click('.chips-dialog .act.raise');
  await expect(page.locator('.bankroll-chip')).toContainText('$1,700');

  let decisions = 0, raises = 0, adjusted = 0, rebuys = 0, refreshed = false;
  const started = Date.now();
  while ((await handNo(page)) < HANDS) {
    if (Date.now() - started > 35 * 60_000) throw new Error('soak test ran out of time');
    if (await page.locator('.action-bar:has-text("can\'t cover a rebuy")').count()) break; // out of money
    if (await page.locator('.action-bar button:has-text("Rebuy")').count()) {
      await page.click('.action-bar button:has-text("Rebuy")');
      await page.click('.chips-dialog .act.raise');
      rebuys++;
      continue;
    }
    if (await page.locator('.action-bar.mine').count()) {
      decisions++;
      // Refresh once in the middle of a hand: it must come back exactly.
      if (!refreshed && (await handNo(page)) >= 20) {
        const before = await page.locator('.log').innerText();
        const n = await handNo(page);
        await page.waitForTimeout(400);
        await page.reload();
        await expect(page.locator('.action-bar.mine')).toBeVisible();
        expect(await handNo(page)).toBe(n);
        expect(await page.locator('.log').innerText()).toBe(before);
        refreshed = true;
      }
      const callText = await page.locator('.act.call').innerText();
      const cost = Number(/Call \$([\d,]+)/.exec(callText)?.[1].replace(/,/g, '') ?? '0');
      const stack = await money(await page.locator('.seat.hero .plate .stack').innerText());
      const r = Math.random();
      const canRaise = (await page.locator('.act.raise').count()) > 0;
      // A tight-ish random player, so the bankroll lasts for hundreds of hands.
      if (cost > 0 && (cost > stack * 0.15 ? r < 0.9 : r < 0.55)) await page.click('.act.fold');
      else if (r < 0.8 || !canRaise) await page.click('.act.call');
      else if (r < 0.88) {
        const sizes = ['Min', '⅓ pot', '½ pot', '⅔ pot', 'Pot'];
        await page.locator('.quick').getByRole('button', { name: sizes[Math.floor(Math.random() * sizes.length)], exact: true }).click();
        await page.click('.act.raise');
        if (await page.locator('.action-bar .note').count()) await page.click('.act.raise');
        raises++;
      } else {
        // Type an amount that's too small: it must be adjusted, explained, and need a second click.
        await page.fill('.amount input', '1');
        await page.click('.act.raise');
        await expect(page.locator('.action-bar .note')).toContainText(/Minimum|only option is all-in/);
        adjusted++;
        await page.click('.act.raise');
        raises++;
      }
      if (await page.locator('.act.fold.confirm').count()) await page.click('.act.fold.confirm');
      continue;
    }
    await page.waitForTimeout(40);
  }
  expect(refreshed).toBe(true);

  // Leave with your chips.
  await page.click('.top-actions button:has-text("Leave")');
  await page.click('.settings .act.raise');
  while (!(await page.locator('.bankroll-amount').count())) {
    if (await page.locator('.action-bar.mine').count()) await page.click('.act.call');
    else await page.waitForTimeout(50);
  }
  const summary = await page.locator('.last-session').innerText();
  const boughtIn = Number(/bought in \$([\d,]+)/.exec(summary)![1].replace(/,/g, ''));
  const cashedOut = Number(/cashed out \$([\d,]+)/.exec(summary)![1].replace(/,/g, ''));
  const handsPlayed = Number(/after ([\d,]+) hands?/.exec(summary)![1].replace(/,/g, ''));
  const bankroll = await money(await page.locator('.bankroll-amount').innerText());
  expect(bankroll).toBe(2000 - boughtIn + cashedOut);

  // Export the session and check every hand adds up.
  await page.goto('/#/history');
  await expect(page.locator('.summary-line')).toContainText(`${handsPlayed} hand`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download .xlsx")')]);
  const path = await download.path();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path!);
  const rows = (name: string) => {
    const ws = wb.getWorksheet(name)!;
    const header = (ws.getRow(1).values as unknown[]).slice(1) as string[];
    const out: Record<string, unknown>[] = [];
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const v = (row.values as unknown[]).slice(1);
      out.push(Object.fromEntries(header.map((h, k) => [h, v[k]])));
    });
    return out;
  };
  const hands = rows('Hands');
  const actions = rows('Actions');
  expect(hands.length).toBe(handsPlayed);
  const byHand = new Map<unknown, Record<string, unknown>[]>();
  for (const a of actions) byHand.set(a['Hand ID'], [...(byHand.get(a['Hand ID']) ?? []), a]);
  let bets = 0;
  for (const h of hands) {
    const acts = byHand.get(h['Hand ID'])!;
    const put = acts.filter((a) => a.Action !== 'uncalled bet returned').reduce((s, a) => s + Number(a['Amount added'] ?? 0), 0);
    const back = acts.filter((a) => a.Action === 'uncalled bet returned').reduce((s, a) => s + Number(a['Amount added'] ?? 0), 0);
    expect(put - back).toBe(h['Final pot']);
    for (const a of acts) if (a.Action === 'bet' || a.Action === 'raise') { bets++; expect(Number(a['Bet % of pot'])).toBeGreaterThan(0); }
  }
  expect(bets).toBeGreaterThan(handsPlayed / 4);
  expect(hands.reduce((s, h) => s + Number(h['My net result']), 0)).toBe(cashedOut - boughtIn);

  console.log(JSON.stringify({ target: HANDS, handsPlayed, decisions, raises, adjusted, rebuys, boughtIn, cashedOut, bets }));
  expect(errors).toEqual([]);
});
