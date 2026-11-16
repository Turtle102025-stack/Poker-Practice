import { useState } from 'react';
import type { GameStore, RakeSettings, StoreSnapshot } from '../app/gameStore';
import { STAKES } from '../table/stakes';
import { BackupDialog } from './BackupDialog';
import { money, signedMoney } from './format';

interface Props {
  store: GameStore;
  snap: StoreSnapshot;
}

/** The card room: your bankroll and the five games. */
export default function LobbyPage({ store, snap }: Props) {
  const [showRake, setShowRake] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const bankroll = snap.profile.bankroll;
  const last = snap.lastSession;

  return (
    <div className="page lobby">
      <header className="lobby-head">
        <div className="brand"><span className="logo">♠</span> Poker Practice</div>
        <nav className="row wrap">
          <a className="link" href="#/stats">📈 Stats</a>
          <a className="link" href="#/history">📜 Hand history &amp; export</a>
          <a className="link" href="#/players">👥 Players &amp; reads</a>
          <a className="link" href="#/players/reveal">🔍 Reveal styles</a>
          <button onClick={() => setShowRake(true)}>⚙ Rake {snap.rake.enabled ? `(${snap.rake.percent}%)` : '(off)'}</button>
          <button onClick={() => setShowBackup(true)}>💾 Backup</button>
          <a className="link" href="#/rules">✓ Rules check</a>
        </nav>
      </header>

      <section className="bankroll-card">
        <div className="muted">Bankroll</div>
        <div className="bankroll-amount">{money(bankroll)}</div>
        {snap.profile.resets > 0 && <div className="muted small">Restarted {snap.profile.resets} time{snap.profile.resets > 1 ? 's' : ''}</div>}
      </section>

      {snap.storageError && <p className="error">{snap.storageError}. Your progress may not be saved in this browser mode.</p>}

      {last && (
        <section className="last-session">
          <div>
            You left the {last.stake.label} table after {last.hands} hand{last.hands === 1 ? '' : 's'}:
            bought in {money(last.boughtIn)}, cashed out {money(last.cashedOut)}{' '}
            <b className={last.cashedOut - last.boughtIn >= 0 ? 'pos' : 'neg'}>({signedMoney(last.cashedOut - last.boughtIn)})</b>
          </div>
          <button onClick={() => store.dismissLastSession()} aria-label="Dismiss">✕</button>
        </section>
      )}

      {store.canReset() && (
        <section className="reset-card">
          <p>
            <b>You're out of money.</b> {bankroll > 0 ? `Your ${money(bankroll)} isn't enough for any table. ` : ''}
            Start over with a fresh {money(2000)}? Your past results stay in your history.
          </p>
          <button className="act raise" onClick={() => void store.resetBankroll()}>Reset bankroll to $2,000</button>
        </section>
      )}

      <h2>Tables</h2>
      <div className="table-list">
        {STAKES.map((s) => {
          const ok = store.canAfford(s);
          return (
            <div key={s.id} className={`table-card ${ok ? '' : 'locked'}`}>
              <div className="tc-main">
                <div className="tc-name">{s.label} <span className="muted">No-Limit Hold'em</span></div>
                <div className="muted small">
                  Blinds {money(s.smallBlind)}/{money(s.bigBlind)} · Buy-in {money(s.minBuyIn)} to {s.maxBuyIn ? money(s.maxBuyIn) : 'no max'} · 10 seats
                </div>
              </div>
              {ok ? (
                <a className="act raise sit-btn" href={`#/join/${s.id}`}>Sit down</a>
              ) : (
                <div className="lock" title="Not enough in your bankroll">🔒 Need {money(s.minBuyIn)}</div>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted small">
        Everything is saved in this browser: your bankroll, the table you're at (even mid-hand), and your settings.
      </p>

      {showBackup && <BackupDialog seated={!!snap.table} onClose={() => setShowBackup(false)} />}
      {showRake && <RakeDialog rake={snap.rake} onSave={(r) => { void store.setRake(r); setShowRake(false); }} onClose={() => setShowRake(false)} />}
    </div>
  );
}

function RakeDialog({ rake, onSave, onClose }: { rake: RakeSettings; onSave: (r: RakeSettings) => void; onClose: () => void }) {
  const [r, setR] = useState(rake);
  const num = (v: string, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings" role="dialog" aria-label="Rake settings" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Rake</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="muted">The house's cut of each pot. Off by default.</p>
        <label className="toggle">
          <input type="checkbox" checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} />
          <span>Take rake from each pot</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={r.noFlopNoDrop} onChange={(e) => setR({ ...r, noFlopNoDrop: e.target.checked })} />
          <span>No flop, no drop<small>No rake when the hand ends before the flop.</small></span>
        </label>
        <div className="rake-grid">
          <label>Percent of pot <input inputMode="decimal" value={r.percent} onChange={(e) => setR({ ...r, percent: Math.min(20, num(e.target.value, r.percent)) })} />%</label>
          {STAKES.map((s) => (
            <label key={s.id}>
              Cap at {s.label} $<input inputMode="numeric" value={r.caps[s.id]} onChange={(e) => setR({ ...r, caps: { ...r.caps, [s.id]: Math.round(num(e.target.value, r.caps[s.id])) } })} />
            </label>
          ))}
        </div>
        <div className="row wrap">
          <button className="act raise" onClick={() => onSave(r)}>Save</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
