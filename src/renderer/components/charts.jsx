import React, { useMemo, useState } from 'react';
import { fmt } from './ui';

const niceMax = (v) => {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
};

/** Horizontal ranked bars. items: [{key,label,value,sub?}] */
export function BarList({ items, format = (v) => fmt(v), onSelect, selected, max }) {
  const top = max ?? Math.max(...items.map((i) => i.value), 0.0001);
  return (
    <div className="barlist">
      {items.map((it, idx) => (
        <button
          key={it.key}
          type="button"
          className={`barrow ${selected === it.key ? 'selected' : ''}`}
          onClick={() => onSelect && onSelect(it.key)}
        >
          <span className="barrow-rank">{idx + 1}</span>
          <span className="barrow-label">{it.label}</span>
          <span className="bartrack">
            <span className="barfill" style={{ width: `${Math.max(2, (Math.max(0, it.value) / top) * 100)}%` }} />
          </span>
          <span className="barrow-value">{format(it.value)}</span>
        </button>
      ))}
    </div>
  );
}

/** Padded axis domain around the data so clustered points still spread out. */
function domain(values) {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (!Number.isFinite(lo)) return [0, 1];
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12;
  return [Math.max(0, lo - pad), hi + pad];
}

/** Scatter with axes and hover. points: [{key,label,x,y}] */
export function Scatter({ points, xLabel, yLabel, onSelect, selected, height = 300 }) {
  const [hover, setHover] = useState(null);
  const W = 560;
  const H = height;
  const m = { l: 44, r: 14, t: 12, b: 36 };
  const [x0, x1] = useMemo(() => domain(points.map((p) => p.x)), [points]);
  const [y0, y1] = useMemo(() => domain(points.map((p) => p.y)), [points]);
  const sx = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const hp = hover && points.find((p) => p.key === hover);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`${yLabel} versus ${xLabel}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={sy(y0 + t * (y1 - y0))} y2={sy(y0 + t * (y1 - y0))} className="grid" />
            <text x={m.l - 8} y={sy(y0 + t * (y1 - y0)) + 4} textAnchor="end" className="axis">{fmt(y0 + t * (y1 - y0), 0)}</text>
            <text x={sx(x0 + t * (x1 - x0))} y={H - m.b + 18} textAnchor="middle" className="axis">{fmt(x0 + t * (x1 - x0), 0)}</text>
          </g>
        ))}
        <text x={(W + m.l) / 2} y={H - 4} textAnchor="middle" className="axis-title">{xLabel}</text>
        <text transform={`translate(12 ${(H - m.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{yLabel}</text>
        {points.map((p) => (
          <circle
            key={p.key}
            cx={sx(p.x)}
            cy={sy(p.y)}
            r={selected === p.key || hover === p.key ? 7 : 5}
            className={`dot ${selected === p.key ? 'selected' : ''}`}
            onMouseEnter={() => setHover(p.key)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect && onSelect(p.key)}
          />
        ))}
        {hp && (
          <g pointerEvents="none">
            <rect x={Math.min(sx(hp.x) + 10, W - 130)} y={Math.max(sy(hp.y) - 38, 4)} width="120" height="34" rx="6" className="tip-bg" />
            <text x={Math.min(sx(hp.x) + 18, W - 122)} y={Math.max(sy(hp.y) - 22, 20)} className="tip-title">{hp.label}</text>
            <text x={Math.min(sx(hp.x) + 18, W - 122)} y={Math.max(sy(hp.y) - 8, 34)} className="tip-sub">{fmt(hp.x, 0)} · {fmt(hp.y, 1)}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

/** Line chart over matches. series: [{label, color, points:[{x:label,y}]}] */
export function LineChart({ points, yLabel, height = 220 }) {
  const W = 560;
  const H = height;
  const m = { l: 40, r: 14, t: 14, b: 30 };
  if (points.length === 0) return null;
  const yMax = niceMax(Math.max(...points.map((p) => p.y), 1));
  const sx = (i) => m.l + (points.length === 1 ? (W - m.l - m.r) / 2 : (i / (points.length - 1)) * (W - m.l - m.r));
  const sy = (v) => H - m.b - (v / yMax) * (H - m.t - m.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${sx(i)},${sy(p.y)}`).join(' ');
  const area = `${path} L${sx(points.length - 1)},${H - m.b} L${sx(0)},${H - m.b} Z`;
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={yLabel}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={sy(t * yMax)} y2={sy(t * yMax)} className="grid" />
            <text x={m.l - 8} y={sy(t * yMax) + 4} textAnchor="end" className="axis">{fmt(t * yMax, 0)}</text>
          </g>
        ))}
        <path d={area} className="area" />
        <path d={path} className="line" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={sx(i)} cy={sy(p.y)} r="4.5" className="dot selected" />
            <text x={sx(i)} y={H - m.b + 18} textAnchor="middle" className="axis">{p.x}</text>
            <text x={sx(i)} y={sy(p.y) - 10} textAnchor="middle" className="axis strong">{fmt(p.y, 1)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Stacked distribution bars. items: [{label,value,tone}] */
export function Distribution({ items }) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <div className="dist">
      <div className="dist-bar">
        {items.map((it) => (
          <span key={it.label} className={`seg tone-${it.tone}`} style={{ width: `${(it.value / total) * 100}%` }} title={`${it.label}: ${it.value}`} />
        ))}
      </div>
      <ul className="dist-legend">
        {items.map((it) => (
          <li key={it.label}>
            <i className={`tone-${it.tone}`} />
            <span>{it.label}</span>
            <strong>{it.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
