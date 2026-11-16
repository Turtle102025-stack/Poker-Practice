import { useRef, useState } from 'react';
import { makeBackup, restoreBackup } from '../storage/backup';
import { getDb } from '../storage/db';
import { downloadFile } from '../history/files';

/** Download everything as a file, or restore from one. */
export function BackupDialog({ seated, onClose }: { seated: boolean; onClose: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const download = async () => {
    setBusy(true);
    try {
      const b = await makeBackup(getDb());
      const day = new Date().toISOString().slice(0, 10);
      downloadFile(`poker-practice-backup-${day}.json`, JSON.stringify(b), 'application/json');
      setMsg(`Backup saved: ${b.tables.hands.length.toLocaleString()} hands, ${b.tables.notes.length} player notes.`);
    } catch (e) {
      setMsg(`Backup failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File) => {
    try {
      setPending(JSON.parse(await file.text()));
      setMsg(null);
    } catch {
      setMsg('That file could not be read as a backup.');
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      const r = await restoreBackup(getDb(), pending);
      setMsg(`Restored ${r.hands.toLocaleString()} hands. Reloading…`);
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings" role="dialog" aria-label="Backup and restore" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Backup &amp; restore</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="muted">
          Your progress lives in this browser on this device. A backup file keeps it safe, or moves it to another
          browser: bankroll, the table you're at, sessions, every hand, your notes and stats.
        </p>
        <button className="act raise" disabled={busy} onClick={() => void download()}>Download backup</button>

        <h3>Restore</h3>
        {seated ? (
          <p className="muted">Leave your table first, then restore.</p>
        ) : (
          <>
            <input ref={fileRef} type="file" accept=".json,application/json" aria-label="Backup file"
              onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
            {pending !== null && (
              <div className="reset-card">
                <p><b>Replace everything in this browser with this backup?</b> Your current bankroll, hands and notes here will be overwritten.</p>
                <div className="row wrap">
                  <button className="act raise" disabled={busy} onClick={() => void restore()}>Restore backup</button>
                  <button onClick={() => { setPending(null); if (fileRef.current) fileRef.current.value = ''; }}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}
        {msg && <p className="note">{msg}</p>}
      </div>
    </div>
  );
}
