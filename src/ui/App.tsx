import { useEffect, useState, useSyncExternalStore } from 'react';
import { GameStore } from '../app/gameStore';
import HistoryPage from './HistoryPage';
import JoinPage from './JoinPage';
import LobbyPage from './LobbyPage';
import RulesCheckPage from './RulesCheckPage';
import { loadSettings } from './settingsStore';
import TablePage from './table/TablePage';

/** Minimal hash routing so the site works from any folder on GitHub Pages. */
function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '');
}

const store = new GameStore({ tableSettings: loadSettings });
void store.load();

export default function App() {
  const route = useHashRoute();
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);

  if (route === 'rules') return <RulesCheckPage />;
  if (!snap.loaded) return <div className="page muted">Loading your bankroll…</div>;

  if (route === 'history') return <HistoryPage snap={snap} />;

  // Seated at a table: always show it (refreshing brings you back to the same hand).
  if (snap.table) {
    if (route !== 'table') window.history.replaceState(null, '', '#/table');
    return <TablePage key={snap.table.sessionId} store={store} app={snap} active={snap.table} />;
  }
  const join = /^join\/([\w-]+)$/.exec(route);
  if (join) return <JoinPage key={join[1]} store={store} snap={snap} stakeId={join[1]} />;
  if (route === 'table') window.history.replaceState(null, '', '#/');
  return <LobbyPage store={store} snap={snap} />;
}
