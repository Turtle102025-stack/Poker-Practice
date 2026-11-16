import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ActiveTable, GameStore, StoreSnapshot } from '../../app/gameStore';
import type { TableSettings } from '../../table/controller';
import { emptyCounts, summarize } from '../../ai/publicStats';
import { copyText } from '../../history/files';
import { toPokerStars } from '../../history/pokerstars';
import { ChipsDialog } from '../components/ChipsDialog';
import { money } from '../format';
import { saveSettings } from '../settingsStore';
import { ActionBar } from './ActionBar';
import { ActionLog } from './ActionLog';
import { PlayerPanel } from './PlayerPanel';
import { SettingsPanel } from './SettingsPanel';
import { TableFelt } from './TableFelt';

/** The table you're sitting at, with your bankroll, add-chips and leave. */
export default function TablePage({ store, app, active }: { store: GameStore; app: StoreSnapshot; active: ActiveTable }) {
  const { ctl, director, stake } = active;
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot);
  const [showSettings, setShowSettings] = useState(false);
  const [panelSeat, setPanelSeat] = useState<number | null>(null);
  const [addingChips, setAddingChips] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    ctl.start();
    return () => ctl.suspend();
  }, [ctl]);

  const changeSettings = (patch: Partial<TableSettings>) => {
    ctl.updateSettings(patch);
    saveSettings({ ...ctl.getSnapshot().settings });
  };

  const panelOcc = panelSeat !== null ? snap.seats[panelSeat] : null;
  const addRange = store.addChipsRange();
  const heroStack = ctl.heroStack();
  const net = heroStack + (ctl.heroInHand() ? snap.hand?.players.find((p) => p.seat === snap.heroSeat)?.committed ?? 0 : 0) - active.boughtIn;

  return (
    <div className="table-page">
      <header className="topbar">
        <div className="brand">
          <span className="logo">♠</span>
          <span className="title">Poker Practice</span>
        </div>
        <div className="table-info">
          {snap.table.name} · Hand #{snap.handNo}
        </div>
        <div className="bankroll-chip" title="Money off the table">
          Bankroll <b>{money(app.profile.bankroll)}</b>
          <span className="label"> · session <b className={net >= 0 ? 'pos' : 'neg'}>{net >= 0 ? '+' : ''}{money(net)}</b></span>
        </div>
        <div className="top-actions">
          <button onClick={() => ctl.setPaused(!snap.paused)} className={snap.paused ? 'on' : ''}>
            {snap.paused ? '▶' : '❚❚'}<span className="label"> {snap.paused ? 'Resume' : 'Pause'}</span>
          </button>
          <button onClick={() => setShowSettings(true)} aria-label="Settings">⚙<span className="label"> Settings</span></button>
          <a className="link" href="#/history" title="Hand history and export">📜<span className="label"> History</span></a>
          <a className="link" href="#/stats" title="Your stats">📈<span className="label"> Stats</span></a>
          {snap.leaveAfterHand ? (
            <button className="on" onClick={() => ctl.cancelLeave()} title="Cancel leaving">Leaving after this hand ✕</button>
          ) : (
            <button onClick={() => setConfirmLeave(true)}>Leave<span className="label"> table</span></button>
          )}
        </div>
      </header>

      <main className="table-layout">
        <div className="table-col">
          <TableFelt snap={snap} onSeatClick={setPanelSeat} isTilted={(id) => director.tiltOf(id) > 0.25} labelOf={(id) => app.notes[id]?.label} />
          <ActionBar
            snap={snap}
            ctl={ctl}
            onAddChips={addRange ? () => setAddingChips(true) : undefined}
            onLeave={() => setConfirmLeave(true)}
            onCopyHand={
              app.lastRecord && snap.hand && app.lastRecord.hand.config.handId === snap.hand.config.handId
                ? () => copyText(toPokerStars(app.lastRecord!, { allHoleCards: true }))
                : undefined
            }
          />
        </div>
        <aside className="log-col">
          <ActionLog hand={snap.hand} heroSeat={snap.heroSeat} handNo={snap.handNo} notices={snap.notices} afterNotes={snap.afterNotes} />
          <p className="muted small phase-note">
            Your buy-in came out of your bankroll; leaving puts your chips back. Everything is saved as you
            play, so you can close the page and come back to the same hand.
          </p>
        </aside>
      </main>

      {showSettings && (
        <SettingsPanel
          settings={snap.settings}
          bigBlind={snap.table.bigBlind}
          onChange={changeSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
      {panelOcc && (
        <PlayerPanel
          playerId={panelOcc.id}
          name={panelOcc.name}
          seat={panelOcc.seat}
          stack={panelOcc.isHero ? heroStack : panelOcc.stack}
          session={director.stats.get(panelOcc.id)}
          allTime={summarize(app.observed[panelOcc.id] ?? emptyCounts())}
          note={app.notes[panelOcc.id]}
          onSaveNote={(patch) => void store.setNote(panelOcc.id, patch)}
          revealStyle={snap.settings.revealStyles}
          tilted={director.tiltOf(panelOcc.id) > 0.25}
          onClose={() => setPanelSeat(null)}
        />
      )}
      {addingChips && addRange && (
        <ChipsDialog
          title={heroStack === 0 ? 'Rebuy' : 'Add chips'}
          subtitle={
            stake.maxBuyIn
              ? `You have ${money(heroStack)} on the table. The table maximum is ${money(stake.maxBuyIn)}.`
              : `You have ${money(heroStack)} on the table. This table has no maximum.`
          }
          min={addRange.min}
          max={addRange.max}
          initial={heroStack === 0 ? Math.min(addRange.max, Math.max(addRange.min, 100 * stake.bigBlind)) : addRange.max}
          bankroll={app.profile.bankroll}
          bigBlind={stake.bigBlind}
          confirmLabel={(a) => `Add ${money(a)}`}
          onConfirm={async (amount) => {
            const err = await store.addChips(amount);
            if (!err) setAddingChips(false);
            return err;
          }}
          onCancel={() => setAddingChips(false)}
        />
      )}
      {confirmLeave && (
        <div className="settings-backdrop" onClick={() => setConfirmLeave(false)}>
          <div className="settings" role="dialog" aria-label="Leave the table" onClick={(e) => e.stopPropagation()}>
            <h2>Leave the table?</h2>
            <p>
              {ctl.heroInHand()
                ? `You're in a hand. You'll leave as soon as it's over and take your chips with you.`
                : `You'll take ${money(heroStack)} back to your bankroll.`}
            </p>
            <div className="row wrap">
              <button className="act raise" onClick={() => { setConfirmLeave(false); store.leave(); }}>Leave table</button>
              <button onClick={() => setConfirmLeave(false)}>Stay</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
