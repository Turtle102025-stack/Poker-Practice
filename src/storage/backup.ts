import type { PokerDb } from './db';

/**
 * Backup and restore of everything saved in this browser: bankroll, settings,
 * the table you're at, sessions, every hand, your notes and observed stats.
 */
export interface BackupFile {
  app: 'poker-practice';
  version: 1;
  exportedAt: number;
  tables: Record<string, unknown[]>;
  /** Browser-only settings (table speed, practice mode, ...). */
  localSettings: Record<string, string>;
}

const TABLES = ['kv', 'bankroll', 'sessions', 'hands', 'notes', 'observed'] as const;
const LOCAL_KEYS = ['poker-practice.settings.v1'];

export async function makeBackup(db: PokerDb): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) tables[t] = await db.table(t).toArray();
  const localSettings: Record<string, string> = {};
  try {
    for (const k of LOCAL_KEYS) {
      const v = localStorage.getItem(k);
      if (v !== null) localSettings[k] = v;
    }
  } catch {
    /* not available */
  }
  return { app: 'poker-practice', version: 1, exportedAt: Date.now(), tables, localSettings };
}

/** Checks a file really is a backup from this app. Returns a reason if not. */
export function checkBackup(data: unknown): string | null {
  const b = data as Partial<BackupFile> | null;
  if (!b || typeof b !== 'object') return 'This file is not a backup.';
  if (b.app !== 'poker-practice') return 'This file is not a Poker Practice backup.';
  if (b.version !== 1) return `This backup is from a newer version (${String(b.version)}).`;
  if (!b.tables || typeof b.tables !== 'object') return 'This backup is missing its data.';
  for (const t of TABLES) {
    if (b.tables[t] !== undefined && !Array.isArray(b.tables[t])) return `This backup's "${t}" data is damaged.`;
  }
  const kv = (b.tables.kv ?? []) as Array<{ key?: unknown }>;
  if (!kv.some((r) => r && r.key === 'profile')) return 'This backup has no bankroll in it.';
  return null;
}

/** Replaces everything saved in this browser with the backup. */
export async function restoreBackup(db: PokerDb, data: unknown): Promise<{ hands: number }> {
  const problem = checkBackup(data);
  if (problem) throw new Error(problem);
  const b = data as BackupFile;
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      const rows = b.tables[t] ?? [];
      if (rows.length) await db.table(t).bulkPut(rows);
    }
  });
  try {
    for (const [k, v] of Object.entries(b.localSettings ?? {})) if (LOCAL_KEYS.includes(k)) localStorage.setItem(k, v);
  } catch {
    /* not available */
  }
  return { hands: (b.tables.hands ?? []).length };
}
