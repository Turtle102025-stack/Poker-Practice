import { useEffect, useRef, useState } from 'react';
import { READ_LABELS, type PlayerNote, type ReadLabel } from '../../storage/db';

interface Props {
  note: PlayerNote | undefined;
  onSave: (patch: { label?: ReadLabel; text?: string }) => void;
}

/** Your label and free-text notes on a player. Notes save as you type. */
export function ReadEditor({ note, onSave }: Props) {
  const label = note?.label ?? 'Unknown';
  const [text, setText] = useState(note?.text ?? '');
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(text);
  latest.current = text;

  // Save pending text when the editor closes.
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      if (latest.current !== (note?.text ?? '')) onSave({ text: latest.current });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleSave = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      onSave({ text: value });
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    }, 600);
  };

  return (
    <div className="read-editor">
      <div className="read-labels" role="radiogroup" aria-label="Your label">
        {READ_LABELS.map((l) => (
          <button key={l} role="radio" aria-checked={label === l} className={label === l ? 'on' : ''} onClick={() => onSave({ label: l })}>
            {l}
          </button>
        ))}
      </div>
      <textarea
        aria-label="Your notes"
        placeholder="Your notes: tells, sizing habits, how they played a hand…"
        value={text}
        rows={3}
        onChange={(e) => {
          setText(e.target.value);
          scheduleSave(e.target.value);
        }}
      />
      <div className="muted small">{saved ? 'Saved ✓' : 'Notes are saved automatically and kept between sessions.'}</div>
    </div>
  );
}
