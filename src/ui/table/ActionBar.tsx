import { useEffect, useRef, useState } from 'react';
import { legalizeAmount, potFractionTo, roundToUnit } from '../../engine/betSizing';
import { describeHand, evaluate } from '../../engine/evaluator';
import { legalActions, potTotal } from '../../engine/hand';
import type { LegalActions, PlayerAction } from '../../engine/types';
import type { TableController, TableSnapshot } from '../../table/controller';
import { money, signedMoney } from '../format';

interface Props {
  snap: TableSnapshot;
  ctl: TableController;
  /** Opens the add-chips dialog; undefined when you can't add chips right now. */
  onAddChips?: () => void;
  onLeave?: () => void;
  /** Copies the hand that just finished as PokerStars text. */
  onCopyHand?: () => Promise<boolean>;
}

const QUICK: Array<{ label: string; fraction: number | 'min' | 'all' }> = [
  { label: 'Min', fraction: 'min' },
  { label: '⅓ pot', fraction: 1 / 3 },
  { label: '½ pot', fraction: 1 / 2 },
  { label: '⅔ pot', fraction: 2 / 3 },
  { label: 'Pot', fraction: 1 },
  { label: 'All-in', fraction: 'all' },
];

const SLIDER_STEPS = 1000;

export function ActionBar({ snap, ctl, onAddChips, onLeave, onCopyHand }: Props) {
  const { hand, heroSeat, stage } = snap;
  const heroTurn = !!hand && stage === 'in-hand' && hand.toAct === heroSeat;
  const legal = heroTurn ? legalActions(hand!) : null;
  if (snap.heroBusted) {
    return (
      <div className="action-bar over">
        <b className="neg">You're out of chips.</b>
        <div className="row wrap">
          {onAddChips ? <button className="act raise" onClick={onAddChips}>Rebuy</button> : <span className="muted">Your bankroll can't cover a rebuy.</span>}
          {onLeave && <button onClick={onLeave}>Leave table</button>}
        </div>
      </div>
    );
  }
  if (!hand) return <div className="action-bar"><p className="muted">Waiting for players…</p></div>;
  if (stage === 'hand-over') return <HandOver snap={snap} ctl={ctl} onAddChips={onAddChips} onCopyHand={onCopyHand} />;
  if (heroTurn && legal) return <YourTurn snap={snap} ctl={ctl} legal={legal} />;

  const hero = hand.players.find((p) => p.seat === heroSeat);
  const actor = hand.players.find((p) => p.seat === hand.toAct);
  const me = snap.seats[heroSeat];
  return (
    <div className="action-bar waiting">
      <HandStrength snap={snap} />
      {!hero && me && me.status !== 'active' && (
        <div className="row wrap entry-status">
          {me.status === 'waitingForBB' ? (
            <>
              <span>You'll be dealt in when the big blind reaches you.</span>
              <button onClick={() => ctl.setHeroEntry('postToEnter')}>Post {money(snap.table.bigBlind)} instead</button>
            </>
          ) : (
            <>
              <span>You'll post {money(snap.table.bigBlind)} and come in next hand (not on the button or in the blinds).</span>
              <button onClick={() => ctl.setHeroEntry('waitingForBB')}>Wait for the big blind</button>
            </>
          )}
        </div>
      )}
      <div className="row wrap">
        <span className="muted">
          {snap.paused ? 'Paused.' : `Waiting for ${actor?.name ?? '…'}…`}
        </span>
        {(!hero || hero.folded || hero.allIn) && !snap.fastForward && (
          <button onClick={() => ctl.fastForward()}>Fast-forward ⏩</button>
        )}
      </div>
    </div>
  );
}

function HandStrength({ snap }: { snap: TableSnapshot }) {
  const hero = snap.hand?.players.find((p) => p.seat === snap.heroSeat);
  if (!snap.settings.showHandStrength || !hero || hero.folded || !snap.hand || snap.hand.board.length < 3) return null;
  const text = describeHand(evaluate([...hero.hole, ...snap.hand.board]));
  return <div className="strength">You have {text}</div>;
}

function YourTurn({ snap, ctl, legal }: { snap: TableSnapshot; ctl: TableController; legal: LegalActions }) {
  const hand = snap.hand!;
  const unit = snap.table.smallBlind;
  const pot = potTotal(hand);
  const [amountText, setAmountText] = useState(String(legal.minTo));
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmFold, setConfirmFold] = useState(false);
  const turnKey = `${snap.handNo}-${hand.events.length}`;
  const inputRef = useRef<HTMLInputElement>(null);

  // New decision: reset the amount to the minimum.
  useEffect(() => {
    setAmountText(String(legal.minTo));
    setNote(null);
    setError(null);
    setConfirmFold(false);
  }, [turnKey, legal.minTo]);

  const amount = Number(amountText);

  const act = (a: PlayerAction) => {
    const err = ctl.heroAct(a);
    setError(err);
  };

  const fold = () => {
    if (legal.canCheck && !confirmFold) {
      setConfirmFold(true);
      setTimeout(() => setConfirmFold(false), 3000);
      return;
    }
    act({ type: 'fold' });
  };
  const checkOrCall = () => act(legal.canCheck ? { type: 'check' } : { type: 'call' });

  const submitRaise = () => {
    const fixed = legalizeAmount(legal, amount);
    if (fixed.to !== amount || fixed.note) {
      // Show the adjusted amount and why; the next click confirms it.
      setAmountText(String(fixed.to));
      setNote(fixed.note);
      return;
    }
    act(fixed.allIn ? { type: 'allin' } : { type: legal.isBet ? 'bet' : 'raise', to: fixed.to });
  };

  const quick = (label: string, f: number | 'min' | 'all') => {
    if (f === 'min') return setSized(legal.minTo, null);
    if (f === 'all') return setSized(legal.maxTo, null);
    const raw = roundToUnit(potFractionTo(legal, pot, hand.currentBet, f), unit);
    const fixed = legalizeAmount(legal, raw, label);
    setSized(fixed.to, fixed.note);
  };
  const setSized = (to: number, n: string | null) => {
    setAmountText(String(to));
    setNote(n);
  };

  // Keyboard shortcuts: F fold, C check/call, R bet/raise.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f') { e.preventDefault(); fold(); }
      else if (k === 'c' || k === 'x') { e.preventDefault(); checkOrCall(); }
      else if (k === 'r' || k === 'b') { e.preventDefault(); if (legal.canRaise) submitRaise(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const sliderPos =
    legal.maxTo > legal.minTo && Number.isFinite(amount)
      ? Math.round(((Math.min(Math.max(amount, legal.minTo), legal.maxTo) - legal.minTo) / (legal.maxTo - legal.minTo)) * SLIDER_STEPS)
      : 0;
  const fromSlider = (pos: number) => {
    if (pos >= SLIDER_STEPS) return legal.maxTo;
    const raw = legal.minTo + ((legal.maxTo - legal.minTo) * pos) / SLIDER_STEPS;
    return Math.min(legal.maxTo, Math.max(legal.minTo, roundToUnit(raw, unit)));
  };

  const valid = legalizeAmount(legal, amount);
  const raiseLabel = valid.allIn
    ? `All-in ${money(legal.maxTo)}`
    : `${legal.isBet ? 'Bet' : 'Raise to'} ${money(Number.isFinite(amount) && amount > 0 ? amount : legal.minTo)}`;

  return (
    <div className="action-bar mine">
      <HandStrength snap={snap} />
      <div className="main-buttons">
        <button className={`act fold ${confirmFold ? 'confirm' : ''}`} onClick={fold}>
          {confirmFold ? 'Fold? You can check' : 'Fold'} <kbd>F</kbd>
        </button>
        <button className="act call" onClick={checkOrCall}>
          {legal.canCheck ? 'Check' : `Call ${money(legal.callAmount)}${legal.callAmount < legal.facing ? ' (all-in)' : ''}`} <kbd>C</kbd>
        </button>
        {legal.canRaise && (
          <button className="act raise" onClick={submitRaise}>
            {raiseLabel} <kbd>R</kbd>
          </button>
        )}
      </div>
      {legal.canRaise ? (
        <div className="sizing">
          <div className="quick">
            {QUICK.map((q) => (
              <button key={q.label} onClick={() => quick(q.label, q.fraction)}>{q.label}</button>
            ))}
          </div>
          <div className="slider-row">
            <input
              type="range"
              min={0}
              max={SLIDER_STEPS}
              value={sliderPos}
              disabled={legal.minTo === legal.maxTo}
              onChange={(e) => setSized(fromSlider(Number(e.target.value)), null)}
              aria-label="Bet size"
            />
            <label className="amount">
              $
              <input
                ref={inputRef}
                inputMode="numeric"
                value={amountText}
                aria-label="Bet amount"
                onChange={(e) => {
                  setAmountText(e.target.value.replace(/[^0-9]/g, ''));
                  setNote(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRaise();
                }}
              />
            </label>
          </div>
          <div className="range-hint muted">
            {legal.isBet ? 'Bet' : 'Raise to'} {money(legal.minTo)} – {money(legal.maxTo)}
            {legal.facing > 0 && <> · to call {money(legal.callAmount)}</>} · pot {money(pot)}
          </div>
        </div>
      ) : (
        legal.raiseBlockedReason && <p className="muted small">No raise possible: {legal.raiseBlockedReason}.</p>
      )}
      {note && <p className="note">{note}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function HandOver({ snap, ctl, onAddChips, onCopyHand }: { snap: TableSnapshot; ctl: TableController; onAddChips?: () => void; onCopyHand?: () => Promise<boolean> }) {
  const [copied, setCopied] = useState(false);
  const hand = snap.hand!;
  const net = hand.result?.net[snap.heroSeat];
  const heroIn = net !== undefined;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (snap.autoDealAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [snap.autoDealAt]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        ctl.dealNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctl]);

  const winners = new Map<number, number>();
  for (const e of hand.events) if (e.type === 'award') winners.set(e.seat, (winners.get(e.seat) ?? 0) + e.amount);
  // Your line shows your profit; list everyone else who won chips.
  const summary = [...winners.entries()]
    .filter(([seat]) => seat !== snap.heroSeat)
    .map(([seat, amt]) => `${hand.players.find((p) => p.seat === seat)!.name} won ${money(amt)}`)
    .join(' · ');
  const secs = snap.autoDealAt !== null ? Math.max(0, Math.ceil((snap.autoDealAt - now) / 1000)) : null;

  return (
    <div className="action-bar over">
      <div className="result-line">
        {heroIn && (
          <b className={net! > 0 ? 'pos' : net! < 0 ? 'neg' : ''}>
            {net! > 0 ? `You won ${money(net!)}` : net! < 0 ? `You lost ${money(-net!)}` : 'You broke even'}
          </b>
        )}
        <span className="muted">{summary}</span>
      </div>
      <div className="row wrap">
        <button className="act raise" onClick={() => ctl.dealNow()}>
          Deal next hand <kbd>Space</kbd>
        </button>
        {secs !== null && <span className="muted">Next hand in {secs}s</span>}
        {onAddChips && <button onClick={onAddChips}>Add chips</button>}
        {onCopyHand && (
          <button
            onClick={async () => {
              setCopied(await onCopyHand());
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? 'Copied ✓' : 'Copy hand history'}
          </button>
        )}
      </div>
      {snap.afterNotes.length > 0 && <p className="muted small">{snap.afterNotes.join(" ")}</p>}
      {heroIn && net !== 0 && <span className="sr-only">{signedMoney(net!)}</span>}
    </div>
  );
}
