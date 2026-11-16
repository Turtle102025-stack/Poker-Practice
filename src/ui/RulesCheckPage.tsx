import { useState } from 'react';
import { Simulator, type SimReport } from '../engine/simulate';

const SIM_HANDS = 10_000;

const ROWS: Array<[string, keyof SimReport]> = [
  ['Hands played', 'hands'],
  ['Actions taken', 'actions'],
  ['Showdowns (winners double-checked)', 'showdowns'],
  ['Hands with side pots', 'sidePotHands'],
  ['Split pots', 'splitPots'],
  ['All-in run-outs', 'allInRunouts'],
  ['Straddles', 'straddles'],
  ['New players posting in', 'livePosts'],
  ['Dead buttons', 'deadButtons'],
  ['Dead small blinds', 'deadSmallBlinds'],
  ['Heads-up hands', 'headsUpHands'],
  ['Raked hands', 'rakedHands'],
  ['Illegal actions rejected', 'illegalAttemptsRejected'],
];

export default function RulesCheckPage() {
  const [report, setReport] = useState<SimReport | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const run = () => {
    const sim = new Simulator(Date.now());
    setRunning(true);
    setReport(null);
    let done = 0;
    const step = () => {
      const ok = sim.runBatch(250);
      done += 250;
      setProgress(done);
      if (ok && done < SIM_HANDS) setTimeout(step, 0);
      else {
        setReport({ ...sim.report, errors: [...sim.report.errors] });
        setRunning(false);
      }
    };
    setTimeout(step, 0);
  };

  return (
    <div className="page">
      <a className="link" href="#/">← Back to the table</a>
      <h1>Rules check</h1>
      <p className="muted">
        Plays {SIM_HANDS.toLocaleString()} hands in your browser between random players with random (often tiny)
        stacks who make every kind of legal move, while players come and go. After every action it checks that
        chips are conserved and only legal actions are accepted, and it re-checks every showdown winner with a
        second, independent hand evaluator.
      </p>
      <button className="act raise" disabled={running} onClick={run}>
        {running ? `Running… ${progress.toLocaleString()} hands` : `Run ${SIM_HANDS.toLocaleString()}-hand rules check`}
      </button>
      {report && (
        <div className="report">
          <p className={report.errors.length ? 'error' : 'ok'}>
            {report.errors.length ? `${report.errors.length} problem(s) found` : '✓ No rule violations'}
          </p>
          <table>
            <tbody>
              {ROWS.map(([label, key]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td className="num">{(report[key] as number).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.errors.map((e, i) => (
            <pre key={i} className="error small">{e}</pre>
          ))}
        </div>
      )}
    </div>
  );
}
