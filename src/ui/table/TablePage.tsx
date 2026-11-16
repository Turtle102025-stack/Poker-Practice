import { useEffect, useState, useSyncExternalStore } from 'react';
import { AiDirector } from '../../ai/director';
import { secureRng } from '../../engine/rng';
import { TableController, type Occupant, type TableSettings } from '../../table/controller';
import { Seating } from '../../table/seating';
import { stakeById, STAKES, type Stake } from '../../table/stakes';
import { loadSettings, saveSettings } from '../settingsStore';
import { ActionBar } from './ActionBar';
import { ActionLog } from './ActionLog';
import { PlayerPanel } from './PlayerPanel';
import { SettingsPanel } from './SettingsPanel';
import { TableFelt } from './TableFelt';

/**
 * Phase 3: you at a table of players from the 50-player pool. Until the lobby
 * and bankroll arrive in Phase 4, you sit with 100 big blinds and rebuy for free.
 */
const STAKE_KEY = 'poker-practice.practiceStake.v1';

function heroStackFor(stake: Stake): number {
  return Math.min(stake.maxBuyIn ?? Infinity, 100 * stake.bigBlind);
}

function createTable(stake: Stake): { ctl: TableController; director: AiDirector } {
  const rng = secureRng;
  const seating = new Seating(stake, rng);
  const director = new AiDirector(seating, rng);
  const heroSeat = rng.int(10);
  const heroStack = heroStackFor(stake);
  let seats: Array<Occupant | null> = Array.from({ length: 10 }, () => null);
  seats[heroSeat] = { seat: heroSeat, id: 'hero', name: 'You', stack: heroStack, status: 'active', isHero: true };
  seats = seating.initialFill(seats);
  const ctl = new TableController({
    table: { id: stake.id, name: stake.name, smallBlind: stake.smallBlind, bigBlind: stake.bigBlind, numSeats: 10 },
    heroSeat,
    heroStack,
    bots: seats.filter((o): o is Occupant => !!o && !o.isHero).map(({ seat, id, name, stack }) => ({ seat, id, name, stack })),
    rebuyStack: heroStack,
    settings: loadSettings(),
    hooks: director,
    rng,
  });
  return { ctl, director };
}

function loadStake(): Stake {
  try {
    return stakeById(localStorage.getItem(STAKE_KEY) ?? '1-3');
  } catch {
    return STAKES[0];
  }
}

export default function TablePage() {
  const [stake, setStake] = useState(loadStake);
  const changeStake = (s: Stake) => {
    try {
      localStorage.setItem(STAKE_KEY, s.id);
    } catch {
      /* ignore */
    }
    setStake(s);
  };
  return <TableSession key={stake.id} stake={stake} onChangeStake={changeStake} />;
}

function TableSession({ stake, onChangeStake }: { stake: Stake; onChangeStake: (s: Stake) => void }) {
  const [{ ctl, director }] = useState(() => createTable(stake));
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot);
  const [showSettings, setShowSettings] = useState(false);
  const [panelSeat, setPanelSeat] = useState<number | null>(null);

  useEffect(() => {
    ctl.start();
    return () => ctl.suspend();
  }, [ctl]);

  const changeSettings = (patch: Partial<TableSettings>) => {
    ctl.updateSettings(patch);
    saveSettings({ ...ctl.getSnapshot().settings });
  };

  const panelOcc = panelSeat !== null ? snap.seats[panelSeat] : null;
  const heroStack = heroStackFor(stake);

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
          <TableFelt snap={snap} onSeatClick={setPanelSeat} isTilted={(id) => director.tiltOf(id) > 0.25} />
          <ActionBar snap={snap} ctl={ctl} topUpTo={heroStack} />
        </div>
        <aside className="log-col">
          <ActionLog hand={snap.hand} heroSeat={snap.heroSeat} handNo={snap.handNo} notices={snap.notices} afterNotes={snap.afterNotes} />
          <p className="muted small phase-note">
            Phase 3 preview: the players are drawn from the 50-player pool and come and go as you play.
            Click any player to see who they are. You sit with {`$${heroStack.toLocaleString('en-US')}`} and rebuy for
            free until the lobby and bankroll arrive in Phase 4.
          </p>
        </aside>
      </main>

      {showSettings && (
        <SettingsPanel
          settings={snap.settings}
          bigBlind={snap.table.bigBlind}
          stake={stake}
          onChangeStake={(s) => {
            setShowSettings(false);
            if (s.id !== stake.id) onChangeStake(s);
          }}
          onChange={changeSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
      {panelOcc && (
        <PlayerPanel
          occ={panelOcc}
          stats={director.stats.get(panelOcc.id)}
          revealStyle={snap.settings.revealStyles}
          tilted={director.tiltOf(panelOcc.id) > 0.25}
          onClose={() => setPanelSeat(null)}
        />
      )}
    </div>
  );
}
