import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * A single-series line chart drawn in SVG: thin line, recessive grid, a dashed
 * reference line, the end value labelled, and a crosshair + tooltip on hover
 * or with the arrow keys.
 */
export interface LinePoint {
  ts: number;
  value: number;
  /** One line describing the point, for the tooltip. */
  note: string;
}

interface Props {
  points: LinePoint[];
  reference?: { value: number; label: string };
  format: (v: number) => string;
  height?: number;
  ariaLabel: string;
}

const M = { left: 58, right: 18, top: 18, bottom: 30 };
const MAX_DRAWN = 900;

function niceStep(range: number, ticks: number): number {
  const raw = range / Math.max(1, ticks);
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

const dateLabel = (ts: number) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
const dateTime = (ts: number) =>
  new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function LineChart({ points, reference, format, height = 260, ariaLabel }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(280, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(280, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const plotW = width - M.left - M.right;
  const plotH = height - M.top - M.bottom;

  const geom = useMemo(() => {
    const values = points.map((p) => p.value);
    if (reference) values.push(reference.value);
    let lo = Math.min(...values), hi = Math.max(...values);
    if (lo === hi) { lo -= 1; hi += 1; }
    const step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
    const x = (i: number) => M.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v: number) => M.top + plotH - ((v - lo) / (hi - lo)) * plotH;
    const every = Math.max(1, Math.ceil(n / MAX_DRAWN));
    const idx: number[] = [];
    for (let i = 0; i < n; i += every) idx.push(i);
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    const path = idx.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(points[i].value).toFixed(1)}`).join('');
    return { x, y, ticks, path };
  }, [points, reference, n, plotW, plotH]);

  if (n === 0) return null;
  const last = points[n - 1];

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    const px = e.clientX - rect.left - M.left;
    setHover(Math.max(0, Math.min(n - 1, Math.round((px / plotW) * (n - 1)))));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const d = e.key === 'ArrowRight' ? 1 : -1;
      setHover((h) => Math.max(0, Math.min(n - 1, (h ?? n - 1) + d * (e.shiftKey ? 10 : 1))));
    } else if (e.key === 'Escape') setHover(null);
  };

  const hp = hover !== null ? points[hover] : null;
  const tipLeft = hover !== null ? Math.min(Math.max(geom.x(hover) - 90, 4), width - 184) : 0;

  return (
    <div className="line-chart" ref={wrap} tabIndex={0} role="img" aria-label={ariaLabel} onKeyDown={onKey} onBlur={() => setHover(null)}>
      <svg width={width} height={height}>
        {geom.ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={M.left} x2={width - M.right} y1={geom.y(t)} y2={geom.y(t)} />
            <text className="tick" x={M.left - 8} y={geom.y(t) + 4} textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {reference && (
          <g>
            <line className="ref" x1={M.left} x2={width - M.right} y1={geom.y(reference.value)} y2={geom.y(reference.value)} />
            <text className="ref-label" x={M.left + 6} y={geom.y(reference.value) - 6}>{reference.label}</text>
          </g>
        )}
        <text className="tick" x={M.left} y={height - 8}>{dateLabel(points[0].ts)}</text>
        {n > 1 && <text className="tick" x={width - M.right} y={height - 8} textAnchor="end">{dateLabel(last.ts)}</text>}
        <path className="series" d={geom.path} />
        <circle className="end-dot" cx={geom.x(n - 1)} cy={geom.y(last.value)} r={4} />
        {hp && hover !== null && (
          <g>
            <line className="crosshair" x1={geom.x(hover)} x2={geom.x(hover)} y1={M.top} y2={M.top + plotH} />
            <circle className="hover-dot" cx={geom.x(hover)} cy={geom.y(hp.value)} r={5} />
          </g>
        )}
        <rect
          className="hit"
          x={M.left}
          y={M.top}
          width={plotW}
          height={plotH}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      <div className="end-label" style={{ top: Math.max(0, geom.y(last.value) - 30), right: 4 }}>{format(last.value)}</div>
      {hp && (
        <div className="chart-tip" style={{ left: tipLeft, top: 4 }}>
          <div className="tip-value">{format(hp.value)}</div>
          <div className="tip-note">{hp.note}</div>
          <div className="tip-time">{dateTime(hp.ts)}</div>
        </div>
      )}
    </div>
  );
}
