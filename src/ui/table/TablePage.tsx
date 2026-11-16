import { useEffect, useState, useSyncExternalStore } from 'react';
import { secureRng, shuffle } from '../../engine/rng';
import { TableController, type TableSettings } from '../../table/controller';
import { loadSettings, saveSettings } from '../settingsStore';
import { ActionBar } from './ActionBar';
import { ActionLog } from './ActionLog';
import { SettingsPanel } from './SettingsPanel';
import { TableFelt } from './TableFelt';

/** Phase 2: one $1/$3 table, you plus eight simple bots, free $300 rebuys. */
const BOT_NAMES = ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal'];
const BUY_IN = 300;

function createController(): TableController {
  const seats = shuffle(Array.from({ length: 10 }, (_, i) => i));
  const heroSeat = seats[0];
  const botSeats = seats.slice(1, 9); // one seat stays open
  return new TableController({
    table: { id: 'T1', name: "$1/$3 No-Limit Hold'em", smallBlind: 1, bigBlind: 3, numSeats: 10 },
    heroSeat,
    heroStack: BUY_IN,
    bots: botSeats.map((seat, i) => ({
      seat,
      id: `bot-${i}`,
      name: BOT_NAMES[i],
      stack: 150 + 5 * secureRng.int(71), // $150 to $500
    })),
    rebuyStack: BUY_IN,
    settings: loadSettings(),
  });
}

export default function TablePage() {
  const [ctl] = useState(createController);
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    ctl.start();
    return () => ctl.suspend();
  }, [ctl]);

  const changeSettings = (patch: Partial<TableSettings>) => {
    ctl.updateSettings(patch);
    saveSettings({ ...ctl.getSnapshot().settings });
  };

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
        <div className="top-actions">
          <button onClick={() => ctl.setPaused(!snap.paused)} className={snap.paused ? 'on' : ''}>
            {snap.paused ? '▶' : '❚❚'}<span className="label"> {snap.paused ? 'Resume' : 'Pause'}</span>
          </button>
          <button onClick={() => setShowSettings(true)} aria-label="Settings">⚙<span className="label"> Settings</span></button>
          <a className="link" href="#/rules" title="Rules check">✓<span className="label"> Rules check</span></a>
        </div>
      </header>

      <main className="table-layout">
        <div className="table-col">
          <TableFelt snap={snap} />
          <ActionBar snap={snap} ctl={ctl} topUpTo={BUY_IN} />
        </div>
        <aside className="log-col">
          <ActionLog hand={snap.hand} heroSeat={snap.heroSeat} handNo={snap.handNo} />
          <p className="muted small phase-note">
            Phase 2 preview: these are simple placeholder bots with free $300 rebuys. The 50 real
            personalities, the lobby, and saving your bankroll arrive in Phases 3–4.
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
    </div>
  );
}
