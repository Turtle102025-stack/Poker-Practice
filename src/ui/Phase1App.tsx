import { useEffect, useMemo, useRef, useState } from 'react';
import { rankOf, RANK_CHARS, suitOf, SUIT_SYMBOLS, type Card } from '../engine/cards';
import { currentPots, legalActions, potTotal } from '../engine/hand';
import { Simulator, type SimReport } from '../engine/simulate';
import { IllegalActionError, type PlayerAction } from '../engine/types';
import { eventLines } from './logText';
import { HERO_SEAT, Phase1Game } from './phase1Game';
import './phase1.css';

const BOT_DELAY_MS = 450;
const SIM_HANDS = 10_000;

function CardView({ card }: { card: Card | null }) {
  if (card === null) return <span className="card back" aria-label="hidden card" />;
  const suit = suitOf(card);
  const red = suit === 1 || suit === 2;
  const rank = RANK_CHARS[rankOf(card)];
  return (
    <span className={`card ${red ? 'red' : ''}`} aria-label={`${rank}${'cdhs'[suit]}`}>
      {rank === 'T' ? '10' : rank}
      {SUIT_SYMBOLS[suit]}
    </span>
  );
}

const money = (n: number) => `$${n.toLocaleString('en-US')}`;

export default function Phase1App() {
  const game = useRef(new Phase1Game());
  const [hand, setHand] = useState(() => game.current.deal());
  const [error, setError] = useState<string | null>(null);
  const [raiseText, setRaiseText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  const heroTurn = hand.phase !== 'complete' && hand.toAct === HERO_SEAT;
  const legal = heroTurn ? legalActions(hand) : null;
  const lines = useMemo(() => eventLines(hand, HERO_SEAT), [hand]);

  // Bots act after a short pause so you can follow along.
  useEffect(() => {
    if (hand.phase === 'complete' || hand.toAct === HERO_SEAT) return;
    const t = setTimeout(() => setHand(game.current.act(game.current.botAction())), BOT_DELAY_MS);
    return () => clearTimeout(t);
  }, [hand]);

  // Default the raise box to the minimum each time it becomes your turn.
  useEffect(() => {
    if (legal?.canRaise) setRaiseText(String(legal.minTo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroTurn, hand.events.length]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines.length]);

  const doAction = (action: PlayerAction) => {
    try {
      setError(null);
      setHand(game.current.act(action));
    } catch (e) {
      if (e instanceof IllegalActionError) setError(e.message);
      else throw e;
    }
  };

  const pot = potTotal(hand);
  const sizeTo = (fraction: number) => {
    if (!legal) return 0;
    const raw = hand.currentBet + fraction * (pot + legal.facing);
    return Math.max(legal.minTo, Math.min(legal.maxTo, Math.round(raw)));
  };

  const hero = hand.players.find((p) => p.seat === HERO_SEAT)!;
  const pots = currentPots(hand);
  const done = hand.phase === 'complete';

  return (
    <div className="p1">
      <header>
        <h1>Poker Practice</h1>
        <p className="sub">
          Phase 1 preview: the rules engine. You (seat 1) vs five basic bots, $1/$3 No-Limit,
          $300 stacks that refill when anyone busts. The real table, personalities and lobby come in later phases.
        </p>
      </header>

      <section className="panel">
        <div className="row between">
          <h2>Hand #{game.current.handNo}</h2>
          <span className="muted">{done ? 'Hand over' : `${hand.phase[0].toUpperCase()}${hand.phase.slice(1)}`}</span>
        </div>

        <div className="board">
          <span className="label">Board</span>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i}>{hand.board[i] !== undefined ? <CardView card={hand.board[i]} /> : <span className="card empty" />}</span>
          ))}
          <span className="pot">
            Pot {money(pot)}
            {pots.length > 1 && (
              <span className="muted"> ({pots.map((p, i) => `${i === 0 ? 'main' : `side ${i}`} ${money(p.amount)}`).join(', ')})</span>
            )}
          </span>
        </div>

        <table className="seats">
          <thead>
            <tr><th>Seat</th><th>Player</th><th>Pos</th><th>Cards</th><th className="num">Stack</th><th className="num">Bet</th></tr>
          </thead>
          <tbody>
            {hand.players.map((p) => {
              const showCards = p.seat === HERO_SEAT || done;
              return (
                <tr key={p.seat} className={`${p.seat === hand.toAct ? 'acting' : ''} ${p.folded ? 'folded' : ''}`}>
                  <td>{p.seat + 1}{p.seat === hand.config.buttonSeat && <span className="dealer" title="Dealer button">D</span>}</td>
                  <td>{p.seat === HERO_SEAT ? <b>You</b> : p.name}{p.allIn && !done && <span className="tag">all-in</span>}</td>
                  <td>{p.position}</td>
                  <td className="cards">{p.hole.map((c, i) => <CardView key={i} card={showCards ? c : null} />)}</td>
                  <td className="num">{money(p.stack)}</td>
                  <td className="num">{p.committed > 0 ? money(p.committed) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {heroTurn && legal && (
          <div className="controls">
            <div className="row wrap">
              <button className="fold" onClick={() => doAction({ type: 'fold' })}>Fold</button>
              {legal.canCheck ? (
                <button onClick={() => doAction({ type: 'check' })}>Check</button>
              ) : (
                <button onClick={() => doAction({ type: 'call' })}>
                  Call {money(legal.callAmount)}{legal.callAmount < legal.facing ? ' (all-in)' : ''}
                </button>
              )}
            </div>
            {legal.canRaise ? (
              <div className="raise">
                <div className="row wrap">
                  <label>
                    {legal.isBet ? 'Bet' : 'Raise to'} $
                    <input
                      inputMode="numeric"
                      value={raiseText}
                      onChange={(e) => setRaiseText(e.target.value.replace(/[^0-9]/g, ''))}
                    />
                  </label>
                  <button
                    className="primary"
                    onClick={() => {
                      const to = Number(raiseText);
                      doAction(to >= legal.maxTo ? { type: 'allin' } : { type: legal.isBet ? 'bet' : 'raise', to });
                    }}
                  >
                    {legal.isBet ? 'Bet' : 'Raise'}
                  </button>
                </div>
                <div className="row wrap quick">
                  <button onClick={() => setRaiseText(String(legal.minTo))}>Min</button>
                  <button onClick={() => setRaiseText(String(sizeTo(1 / 2)))}>½ pot</button>
                  <button onClick={() => setRaiseText(String(sizeTo(1)))}>Pot</button>
                  <button onClick={() => setRaiseText(String(legal.maxTo))}>All-in</button>
                </div>
                <p className="muted small">
                  Legal: {money(legal.minTo)} to {money(legal.maxTo)}. Try an illegal amount to see the engine reject it.
                </p>
              </div>
            ) : (
              legal.raiseBlockedReason && <p className="muted small">Raising not allowed: {legal.raiseBlockedReason}.</p>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        )}

        {!heroTurn && !done && <p className="muted">Waiting for {hand.players.find((p) => p.seat === hand.toAct)?.name}…</p>}

        {done && (
          <div className="result">
            <p>
              <b>Your result: {hand.result!.net[HERO_SEAT] >= 0 ? '+' : '−'}{money(Math.abs(hand.result!.net[HERO_SEAT] ?? 0))}</b>
              {hero.folded ? ' (you folded)' : ''}. All hole cards are shown (practice mode).
            </p>
            <button className="primary" onClick={() => { setError(null); setHand(game.current.deal()); }}>
              Deal next hand
            </button>
          </div>
        )}
        {game.current.rebuys.length > 0 && (
          <p className="muted small">Rebought to $300: {game.current.rebuys.join(', ')}</p>
        )}
      </section>

      <section className="panel">
        <h2>Action log</h2>
        <div className="log" ref={logRef}>
          {lines.map((l, i) => (
            <div key={i} className={l.startsWith('***') ? 'street' : l.includes(' wins ') ? 'win' : ''}>{l}</div>
          ))}
        </div>
      </section>

      <RulesCheck />
    </div>
  );
}

function RulesCheck() {
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

  const rows: Array<[string, keyof SimReport]> = [
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

  return (
    <section className="panel">
      <h2>Rules check</h2>
      <p className="muted">
        Plays {SIM_HANDS.toLocaleString()} hands in your browser between random players with random (often tiny) stacks who
        make every kind of legal move, while players come and go. After every action it checks that chips are
        conserved and only legal actions are accepted, and it re-checks every showdown winner with a second,
        independent hand evaluator.
      </p>
      <button className="primary" disabled={running} onClick={run}>
        {running ? `Running… ${progress.toLocaleString()} hands` : `Run ${SIM_HANDS.toLocaleString()}-hand rules check`}
      </button>
      {report && (
        <div className="report">
          <p className={report.errors.length ? 'error' : 'ok'}>
            {report.errors.length ? `${report.errors.length} problem(s) found` : '✓ No rule violations'}
          </p>
          <table>
            <tbody>
              {rows.map(([label, key]) => (
                <tr key={key}><td>{label}</td><td className="num">{(report[key] as number).toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
          {report.errors.map((e, i) => <pre key={i} className="error small">{e}</pre>)}
        </div>
      )}
    </section>
  );
}
