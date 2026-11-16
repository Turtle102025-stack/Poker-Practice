import { useEffect, useMemo, useRef } from 'react';
import type { HandState } from '../../engine/types';
import { logLines } from '../logText';

export function ActionLog({ hand, heroSeat, handNo }: { hand: HandState | null; heroSeat: number; handNo: number }) {
  const lines = useMemo(() => (hand ? logLines(hand, heroSeat) : []), [hand, heroSeat]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines.length]);
  return (
    <div className="log-panel">
      <div className="log-title">Hand #{handNo} · action log</div>
      <div className="log" ref={ref} aria-live="polite">
        {lines.map((l, i) => (
          <div key={i} className={`line ${l.kind}`}>{l.text}</div>
        ))}
      </div>
    </div>
  );
}
