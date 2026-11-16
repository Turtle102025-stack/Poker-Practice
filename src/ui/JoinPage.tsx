import { useMemo, useState } from 'react';
import type { GameStore, StoreSnapshot } from '../app/gameStore';
import { DEFAULT_SETTINGS, type TableSnapshot } from '../table/controller';
import { stakeById } from '../table/stakes';
import { ChipsDialog } from './components/ChipsDialog';
import { money } from './format';
import { loadSettings } from './settingsStore';
import { TableFelt } from './table/TableFelt';

/** Look at a table, pick an open seat, and buy in. */
export default function JoinPage({ store, snap, stakeId }: { store: GameStore; snap: StoreSnapshot; stakeId: string }) {
  const stake = useMemo(() => stakeById(stakeId), [stakeId]);
  const [preview] = useState(() => store.previewTable(stake));
  const open = preview.seats.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);
  const [seat, setSeat] = useState<number | null>(open.length === 1 ? open[0] : null);
  const [buying, setBuying] = useState(false);
  const range = store.buyInRange(stake);

  if (!store.canAfford(stake)) {
    return (
      <div className="page">
        <a className="link" href="#/">← Lobby</a>
        <p>You need at least {money(stake.minBuyIn)} to sit at {stake.label}.</p>
      </div>
    );
  }

  const felt: TableSnapshot = {
    table: { id: stake.id, name: stake.name, smallBlind: stake.smallBlind, bigBlind: stake.bigBlind, numSeats: 10 },
    seats: preview.seats,
    heroSeat: 0,
    hand: null,
    handNo: 0,
    stage: 'hand-over',
    autoDealAt: null,
    fastForward: false,
    paused: false,
    actingSince: null,
    notices: [],
    afterNotes: [],
    settings: { ...DEFAULT_SETTINGS, ...loadSettings() },
    heroBusted: false,
    leaveAfterHand: false,
    closed: false,
  };
  const others = preview.seats.filter(Boolean).length;
  const defaultBuyIn = Math.min(range.max, Math.max(range.min, 100 * stake.bigBlind));

  return (
    <div className="table-page">
      <header className="topbar">
        <a className="link" href="#/">← Lobby</a>
        <div className="table-info">{stake.name} · {others} players · pick a seat</div>
        <div className="muted">Bankroll {money(snap.profile.bankroll)}</div>
      </header>
      <main className="join-layout">
        <TableFelt snap={felt} pickSeat={seat} onPickSeat={setSeat} />
        <div className="action-bar">
          {seat === null ? (
            <p>Click an open seat to sit there.</p>
          ) : (
            <div className="row wrap">
              <span>Seat {seat + 1}</span>
              <button className="act raise" onClick={() => setBuying(true)}>Buy in</button>
            </div>
          )}
        </div>
      </main>
      {buying && seat !== null && (
        <ChipsDialog
          title={`Buy in at ${stake.label}`}
          subtitle={`Seat ${seat + 1}. The buy-in comes out of your bankroll; leaving the table puts your chips back.`}
          min={range.min}
          max={range.max}
          initial={defaultBuyIn}
          bankroll={snap.profile.bankroll}
          bigBlind={stake.bigBlind}
          askEntry
          confirmLabel={(a) => `Sit down with ${money(a)}`}
          onConfirm={async (amount, entry) => {
            const err = await store.sitDown(preview, seat, amount, entry);
            if (!err) window.location.hash = '#/table';
            return err;
          }}
          onCancel={() => setBuying(false)}
        />
      )}
    </div>
  );
}
