import { useEffect, useState } from 'react';
import RulesCheckPage from './RulesCheckPage';
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

export default function App() {
  const route = useHashRoute();
  if (route === 'rules') return <RulesCheckPage />;
  return <TablePage />;
}
