/**
 * Rules stress test from the command line:  npm run sim -- 100000 [seed]
 */
import { Simulator } from '../src/engine/simulate';

const hands = Number(process.argv[2] ?? 100_000);
const seed = Number(process.argv[3] ?? Date.now());
const sim = new Simulator(seed);
const started = Date.now();
let done = 0;
while (done < hands) {
  const n = Math.min(5000, hands - done);
  if (!sim.runBatch(n)) break;
  done += n;
  process.stdout.write(`\r${done.toLocaleString()} hands...`);
}
const r = sim.report;
console.log(`\nSeed ${seed}, ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.table({ ...r, errors: r.errors.length });
if (r.errors.length) {
  console.log(r.errors.join('\n'));
  process.exit(1);
}
console.log('No rule violations.');
