import { useEffect, useMemo, useRef } from 'react';
import type { HandState } from '../../engine/types';
import { logLines } from '../logText';

interface Props {
  hand: HandState | null;
  heroSeat: number;
  handNo: number;
  notices?: string[];
  afterNotes?: string[];
}

export function ActionLog({ hand, heroSeat, handNo, notices = [], afterNotes = [] }: Props) {
  const lines = useMemo(() => (hand ? logLines(hand, heroSeat) : []), [hand, heroSeat]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines.length, afterNotes.length]);
  return (
    <div className="log-panel">
      <div className="log-title">Hand #{handNo} · action log</div>
      <div className="log" ref={ref} aria-live="polite">
        {notices.map((n, i) => (
          <div key={`n${i}`} className="line table">{n}</div>
        ))}
        {lines.map((l, i) => (
          <div key={i} className={`line ${l.kind}`}>{l.text}</div>
        ))}
        {afterNotes.map((n, i) => (
          <div key={`a${i}`} className="line table">{n}</div>
        ))}
      </div>
    </div>
  );
}
