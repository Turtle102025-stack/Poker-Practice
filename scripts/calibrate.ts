/**
 * Measures each playing style:  npm run calibrate -- [hands] [seed] [stakes]
 * e.g. npm run calibrate -- 50000 1 1-3
 */
import { ARCHETYPE_LABELS, type Archetype } from '../src/ai/archetypes';
import { runCalibration, TARGETS } from '../src/ai/calibrate';
import { stakeById } from '../src/table/stakes';

const hands = Number(process.argv[2] ?? 50_000);
const seed = Number(process.argv[3] ?? 1);
const stake = stakeById(process.argv[4] ?? '1-3');
const started = Date.now();
const report = runCalibration({ hands, seed, stake });
const order: Archetype[] = ['nit', 'semiNit', 'tightPassive', 'loosePassive', 'looseAggressive', 'aggroReg', 'goodReg', 'shortStacker'];
const pct = (x: number | null) => (x === null ? '  -  ' : `${(x * 100).toFixed(1)}%`.padStart(6));
const inRange = (x: number | null, [lo, hi]: [number, number]) => (x !== null && x >= lo && x <= hi ? ' ' : '*');

console.log(`${hands.toLocaleString()} hands at ${stake.label}, seed ${seed}, ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log('Style'.padEnd(24) + 'Hands'.padStart(8) + '  VPIP    PFR     3bet    Limp    Cbet   FoldCb   WTSD    AF   bb/100');
let misses = 0;
for (const a of order) {
  const r = report.find((x) => x.archetype === a);
  if (!r) continue;
  const t = TARGETS[a];
  const v = inRange(r.vpip, t.vpip), p = inRange(r.pfr, t.pfr);
  if (v === '*' || p === '*') misses++;
  console.log(
    ARCHETYPE_LABELS[a].padEnd(24) + String(r.hands).padStart(8) + ' ' +
    pct(r.vpip) + v + pct(r.pfr) + p + pct(r.threeBet) + ' ' + pct(r.limp) + ' ' + pct(r.cbet) + ' ' + pct(r.foldToCbet) + ' ' +
    pct(r.wtsd) + ' ' + (r.af === null ? '  - ' : r.af.toFixed(2).padStart(5)) + ' ' + r.bbPer100.toFixed(1).padStart(7),
  );
}
console.log(misses ? `\n* = outside target range (${misses} style(s))` : '\nAll styles within their VPIP/PFR targets.');
