import { useState } from 'react';
import { money } from '../format';

interface Props {
  title: string;
  /** Explanation under the title. */
  subtitle?: string;
  min: number;
  max: number;
  initial: number;
  bankroll: number;
  bigBlind: number;
  confirmLabel: (amount: number) => string;
  /** Ask whether to post a big blind now or wait for it (when sitting down). */
  askEntry?: boolean;
  onConfirm: (amount: number, entry: 'post' | 'wait') => Promise<string | null> | string | null;
  onCancel: () => void;
}

const STEPS = 1000;

/** Choose an amount of chips (buy-in, rebuy or top-up), always within the allowed range. */
export function ChipsDialog({ title, subtitle, min, max, initial, bankroll, bigBlind, confirmLabel, askEntry, onConfirm, onCancel }: Props) {
  const [text, setText] = useState(String(initial));
  const [note, setNote] = useState<string | null>(null);
  const [entry, setEntry] = useState<'post' | 'wait'>('post');
  const [busy, setBusy] = useState(false);
  const amount = Number(text);
  const valid = Number.isInteger(amount) && amount >= min && amount <= max;

  const set = (n: number) => {
    setText(String(n));
    setNote(null);
  };
  const confirm = async () => {
    if (!valid) {
      const fixed = Math.max(min, Math.min(max, Math.round(amount) || min));
      setText(String(fixed));
      setNote(amount < min || !amount ? `The minimum is ${money(min)}.` : `The most you can use here is ${money(max)}.`);
      return;
    }
    setBusy(true);
    const err = await onConfirm(amount, entry);
    setBusy(false);
    if (err) setNote(err);
  };
  const pos = max > min ? Math.round(((Math.min(Math.max(amount || min, min), max) - min) / (max - min)) * STEPS) : STEPS;
  const quick: Array<[string, number]> = [['Min', min]];
  if (100 * bigBlind > min && 100 * bigBlind < max) quick.push(['100 BB', 100 * bigBlind]);
  quick.push(['Max', max]);

  return (
    <div className="settings-backdrop" onClick={onCancel}>
      <div className="settings chips-dialog" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>{title}</h2>
          <button onClick={onCancel} aria-label="Close">✕</button>
        </div>
        {subtitle && <p className="muted">{subtitle}</p>}
        <div className="amount-big">
          $
          <input
            inputMode="numeric"
            aria-label="Amount"
            value={text}
            onChange={(e) => {
              setText(e.target.value.replace(/[^0-9]/g, ''));
              setNote(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void confirm();
            }}
          />
        </div>
        <input
          type="range"
          className="wide-range"
          min={0}
          max={STEPS}
          value={pos}
          disabled={max <= min}
          aria-label="Amount slider"
          onChange={(e) => {
            const p = Number(e.target.value);
            set(p >= STEPS ? max : Math.round(min + ((max - min) * p) / STEPS));
          }}
        />
        <div className="seg">
          {quick.map(([label, v]) => (
            <button key={label} onClick={() => set(v)}>{label} {money(v)}</button>
          ))}
        </div>
        <p className="muted small">
          Allowed: {money(min)} – {money(max)} · Bankroll after: {money(bankroll - (valid ? amount : 0))}
        </p>
        {askEntry && (
          <fieldset className="entry">
            <legend>Coming into a game in progress</legend>
            <label className="toggle">
              <input type="radio" name="entry" checked={entry === 'post'} onChange={() => setEntry('post')} />
              <span>Post {money(bigBlind)} and get dealt in right away<small>Unless you're on the button or in the blinds; then you wait a hand or two.</small></span>
            </label>
            <label className="toggle">
              <input type="radio" name="entry" checked={entry === 'wait'} onChange={() => setEntry('wait')} />
              <span>Wait for the big blind<small>Free, but you sit out until the big blind reaches you.</small></span>
            </label>
          </fieldset>
        )}
        {note && <p className="note">{note}</p>}
        <div className="row wrap">
          <button className="act raise" disabled={busy} onClick={() => void confirm()}>{confirmLabel(valid ? amount : min)}</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
