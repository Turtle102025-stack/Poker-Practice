import { DEFAULT_SETTINGS, type TableSettings } from '../table/controller';

/** Table settings are a per-browser convenience, kept in localStorage. */
const KEY = 'poker-practice.settings.v1';

export function loadSettings(): TableSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: use defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: TableSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
