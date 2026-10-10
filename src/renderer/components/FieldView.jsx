import React, { useEffect, useMemo, useRef, useState } from 'react';
import fieldSrc from '../assets/field.png';
import { buildHeatGrid, startedLeft } from '../../shared/pathData';

const FIELD_ASPECT = 1658 / 806;

let fieldImage = null;
function useFieldImage() {
  const [img, setImg] = useState(fieldImage);
  useEffect(() => {
    if (fieldImage) return;
    const i = new Image();
    i.onload = () => {
      fieldImage = i;
      setImg(i);
    };
    i.src = fieldSrc;
  }, []);
  return img;
}

function heatRGBA(t) {
  const alpha = Math.round(80 + 175 * t);
  let r;
  let g;
  let b;
  if (t < 0.25) { const s = t / 0.25; r = 0; g = s; b = 1; }
  else if (t < 0.5) { const s = (t - 0.25) / 0.25; r = 0; g = 1; b = 1 - s; }
  else if (t < 0.75) { const s = (t - 0.5) / 0.25; r = s; g = 1; b = 0; }
  else { const s = (t - 0.75) / 0.25; r = 1; g = 1 - s; b = 0; }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), alpha];
}

function heatCanvas(runs, filter) {
  const grid = buildHeatGrid(runs, filter);
  const c = document.createElement('canvas');
  c.width = grid.w;
  c.height = grid.h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(grid.w, grid.h);
  if (grid.max > 0) {
    for (let i = 0; i < grid.data.length; i++) {
      const t = grid.data[i] / grid.max;
      if (t < 0.01) continue;
      const [r, g, b, a] = heatRGBA(t);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Draws robot paths over the field. Colours follow scouting-ai's Visualization:
 * auto = pink→red, teleop = cyan→blue, auto→teleop hand-off = yellow→orange,
 * yellow dot = starting position.
 *
 * props.colors  optional {runId: cssColor} to draw each run in a single colour
 *               (used to tell 6 robots apart)
 * props.time    optional seconds: draw only up to that time, plus a robot marker
 */
export default function FieldView({ runs = [], filter = 'both', mode = 'paths', side = 'both', time = null, colors = null, labels = null, className = '' }) {
  const ref = useRef(null);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 640, h: 640 / FIELD_ASPECT });
  const img = useFieldImage();

  const visible = useMemo(
    () =>
      runs.filter((r) => {
        if (r.samples.length < 2) return false;
        if (side === 'left') return startedLeft(r.samples);
        if (side === 'right') return !startedLeft(r.samples);
        return true;
      }),
    [runs, side]
  );
  const heat = useMemo(() => (mode === 'heat' ? heatCanvas(visible, filter) : null), [mode, visible, filter]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.max(200, Math.floor(entry.contentRect.width));
      setSize({ w, h: Math.round(w / FIELD_ASPECT) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = size.w;
    const H = size.h;

    ctx.fillStyle = '#5f5f5f';
    ctx.fillRect(0, 0, W, H);
    if (img) ctx.drawImage(img, 0, 0, W, H);
    // soften the field so paths pop
    ctx.fillStyle = 'rgba(8, 10, 16, 0.28)';
    ctx.fillRect(0, 0, W, H);

    if (heat) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(heat, 0, 0, W, H);
      return;
    }

    const px = (p) => [p.x * W, p.y * H];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const run of visible) {
      let samples = run.samples;
      if (time !== null) samples = samples.filter((s) => s.time <= time);
      if (samples.length === 0) continue;
      const single = colors && colors[run.id];
      const base = Math.max(1.6, W / 360);

      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1];
        const b = samples[i];
        if (filter === 'auto' && !(a.isAuto && b.isAuto)) continue;
        if (filter === 'tele' && (a.isAuto || b.isAuto)) continue;
        const [x1, y1] = px(a);
        const [x2, y2] = px(b);
        if (single) {
          ctx.strokeStyle = single;
          ctx.globalAlpha = b.isAuto ? 1 : 0.85;
          ctx.lineWidth = b.isAuto ? base * 1.5 : base;
        } else {
          let c1;
          let c2;
          if (a.isAuto && b.isAuto) { c1 = '#ff9ec5'; c2 = '#ff3d5a'; }
          else if (!a.isAuto && !b.isAuto) { c1 = '#22e0ff'; c2 = '#3b6bff'; }
          else { c1 = '#ffe14d'; c2 = '#ff9a1f'; }
          const g = ctx.createLinearGradient(x1, y1, x2, y2);
          g.addColorStop(0, c1);
          g.addColorStop(1, c2);
          ctx.strokeStyle = g;
          ctx.globalAlpha = 1;
          ctx.lineWidth = base * 1.25;
        }
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      const [sx, sy] = px(samples[0]);
      ctx.fillStyle = '#ffd60a';
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(4, W / 120), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (time !== null || (labels && labels[run.id])) {
        const [ex, ey] = px(samples[samples.length - 1]);
        ctx.fillStyle = single || '#ffffff';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ex, ey, Math.max(5, W / 95), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (labels && labels[run.id]) {
          ctx.font = `700 ${Math.max(10, Math.round(W / 62))}px -apple-system, system-ui, sans-serif`;
          ctx.textAlign = 'left';
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = 'rgba(0,0,0,.7)';
          ctx.lineWidth = 3;
          ctx.strokeText(labels[run.id], ex + 9, ey - 8);
          ctx.fillText(labels[run.id], ex + 9, ey - 8);
        }
      }
    }
  }, [visible, filter, size, img, heat, time, colors, labels]);

  return (
    <div ref={wrapRef} className={`field-view ${className}`}>
      <canvas ref={ref} style={{ width: size.w, height: size.h }} />
    </div>
  );
}

export function FieldLegend({ mode }) {
  if (mode === 'heat') {
    return (
      <div className="legend">
        <span className="legend-grad" />
        <span>Low → high time spent</span>
      </div>
    );
  }
  return (
    <div className="legend">
      <span><i style={{ background: 'linear-gradient(90deg,#ff9ec5,#ff3d5a)' }} /> Auto</span>
      <span><i style={{ background: 'linear-gradient(90deg,#22e0ff,#3b6bff)' }} /> Teleop</span>
      <span><i className="dot" style={{ background: '#ffd60a' }} /> Start</span>
    </div>
  );
}
