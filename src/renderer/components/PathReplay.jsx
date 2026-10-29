import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FieldView from './FieldView';
import { Button, Segmented } from './ui';
import { squareToQuad, fieldToImage } from '../../shared/fieldProjection';

const SPEEDS = [
  { value: '0.5', label: '0.5×' },
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
  { value: '4', label: '4×' },
];

const clock = (s) => {
  if (!Number.isFinite(s)) return '–';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};

const TRAIL_SECONDS = 2;

/** Index of the last sample at or before `time` (samples are time-ordered), or -1. */
function sampleAt(samples, time) {
  let lo = 0;
  let hi = samples.length - 1;
  if (hi < 0 || samples[0].time > time) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Draws each tracked robot on top of the footage, in its path colour, by
 * projecting its field position back through the field calibration. Lets you
 * check at a glance that every team is locked onto the right robot.
 */
function VideoOverlay({ runs, colors, labels, time, calibration, redOnLeft }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const H = useMemo(() => (calibration ? squareToQuad(calibration) : null), [calibration]);

  useEffect(() => {
    const el = ref.current && ref.current.parentElement;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !size.w || !H) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    // History points are mirrored when red is on the left; undo that to get back to the video's frame.
    const toPx = (s) => {
      const fx = redOnLeft ? 1 - s.x : s.x;
      const fy = redOnLeft ? 1 - s.y : s.y;
      const q = fieldToImage(H, fx, fy);
      return q ? [q.x * size.w, q.y * size.h] : null;
    };
    const r = Math.max(8, size.w / 70);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const run of runs) {
      const S = run.samples;
      const i = sampleAt(S, time);
      if (i < 0 || time - S[i].time > 0.25) continue;
      const color = (colors && colors[run.id]) || '#fff';

      // fading trail of the last couple of seconds
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, r / 4);
      let prev = null;
      for (let k = i; k >= 0 && time - S[k].time <= TRAIL_SECONDS; k -= 2) {
        const p = toPx(S[k]);
        if (p && prev) {
          ctx.globalAlpha = 0.85 * (1 - (time - S[k].time) / TRAIL_SECONDS);
          ctx.beginPath();
          ctx.moveTo(prev[0], prev[1]);
          ctx.lineTo(p[0], p[1]);
          ctx.stroke();
        }
        prev = p;
      }
      ctx.globalAlpha = 1;

      const p = toPx(S[i]);
      if (!p) continue;
      const [x, y] = p;
      // ring on the floor where the robot stands (dashed while it is hidden from the detector)
      ctx.setLineDash(S[i].est ? [5, 4] : []);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.6 + 1.5, r * 0.8 + 1.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.6, r * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      const label = labels && labels[run.id];
      if (label) {
        const fs = Math.max(11, Math.round(size.w / 60));
        ctx.font = `700 ${fs}px -apple-system, system-ui, sans-serif`;
        const tw = ctx.measureText(label).width;
        const bx = x - tw / 2 - 6;
        const by = y - r * 0.8 - fs * 3.2;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(bx, by, tw + 12, fs + 8, 5);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, by + fs + 8);
        ctx.lineTo(x, y - r * 0.8);
        ctx.stroke();
        ctx.fillStyle = '#0b0d12';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, by + (fs + 8) / 2 + 1);
      }
    }
  }, [runs, colors, labels, time, H, redOnLeft, size]);

  return <canvas ref={ref} className="replay-overlay" style={{ width: size.w, height: size.h }} />;
}

/**
 * Plays tracked paths back over time, optionally next to the source video.
 * When a video is available it is the clock, so the dots on the field and the
 * robots in the footage move together; otherwise a timer drives the field alone.
 *
 * Space plays/pauses, ←/→ skip 5 s (with Shift: 1 s), F toggles full screen.
 */
export default function PathReplay({ runs, colors, labels, filter, videoSrc, onMarkStart, busy, calibration, redOnLeft }) {
  const [t, setT] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState('1');
  const [hasVideo, setHasVideo] = useState(Boolean(videoSrc));
  const [duration, setDuration] = useState(0);
  const [theater, setTheater] = useState(false);
  const [overlay, setOverlay] = useState(true);
  const videoRef = useRef(null);
  const rootRef = useRef(null);
  const tRef = useRef(null);
  const last = useRef(0);

  const [start, end] = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of runs) {
      if (!r.samples.length) continue;
      lo = Math.min(lo, r.samples[0].time);
      hi = Math.max(hi, r.samples[r.samples.length - 1].time);
    }
    return Number.isFinite(lo) ? [lo, hi] : [0, 0];
  }, [runs]);

  // With a video the whole footage can be scrubbed (pre-match included); without one, only the tracked span.
  const min = hasVideo ? 0 : start;
  const max = hasVideo && duration > 0 ? duration : end;
  const now = Math.min(Math.max(t === null ? start : t, min), max);
  tRef.current = now;
  const rate = Number(speed);

  const seek = useCallback((time) => {
    const clamped = Math.min(Math.max(time, min), max);
    const v = videoRef.current;
    if (v && hasVideo) v.currentTime = clamped;
    setT(clamped);
  }, [hasVideo, min, max]);

  useEffect(() => { setHasVideo(Boolean(videoSrc)); }, [videoSrc]);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = rate; }, [rate, hasVideo]);

  useEffect(() => {
    if (!playing) return undefined;
    const v = videoRef.current;
    if (v && hasVideo) v.play().catch(() => setPlaying(false));
    last.current = performance.now();
    let raf;
    const tick = (ts) => {
      let next;
      if (v && hasVideo) {
        next = v.currentTime;
        if (v.ended) { setT(next); setPlaying(false); return; }
      } else {
        next = tRef.current + ((ts - last.current) / 1000) * rate;
        last.current = ts;
        if (next >= max) { setT(max); setPlaying(false); return; }
      }
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (v) v.pause();
    };
  }, [playing, hasVideo, rate, max]);

  const toggle = useCallback(() => {
    if (!playing && now >= max - 0.05) seek(min);
    setPlaying((p) => !p);
  }, [playing, now, max, min, seek]);

  // Real full screen: the replay fills the display, nothing else around it.
  const toggleTheater = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => setTheater((x) => !x));
    else setTheater((x) => !x);
  }, []);
  useEffect(() => {
    const onChange = () => setTheater(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range') return;
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(tRef.current + (e.shiftKey ? 1 : 5)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(tRef.current - (e.shiftKey ? 1 : 5)); }
      else if (e.key === 'f' || e.key === 'F') toggleTheater();
      else if (e.key === 'Escape' && theater && !document.fullscreenElement) setTheater(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, seek, toggleTheater, theater]);

  const beforeTracking = now < start - 0.05;

  return (
    <div ref={rootRef} className={`replay ${theater ? 'replay-theater' : ''}`}>
      <div className={`replay-stage ${hasVideo ? 'with-video' : ''}`}>
        {hasVideo && (
          <div className="replay-video-wrap">
          <video
            ref={videoRef}
            src={videoSrc}
            muted
            playsInline
            preload="auto"
            className="replay-video"
            onClick={toggle}
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration || 0);
              e.currentTarget.currentTime = tRef.current;
            }}
            onError={() => setHasVideo(false)}
          />
          {overlay && calibration && <VideoOverlay runs={runs} colors={colors} labels={labels} time={now} calibration={calibration} redOnLeft={redOnLeft} />}
          </div>
        )}
        <div className="replay-field">
          {/* Stored paths are rotated so red is always on the right; undo that here so the field moves the same way as the footage. */}
          <FieldView runs={runs} colors={colors} labels={labels} filter={filter} mode="paths" time={now} flip={Boolean(hasVideo && redOnLeft)} />
          {beforeTracking && <div className="replay-note">Paths start at {clock(start)}</div>}
        </div>
      </div>
      <div className="replay-controls">
        <Button size="sm" icon={playing ? 'pause' : 'play'} onClick={toggle}>{playing ? 'Pause' : 'Play'}</Button>
        <input
          type="range"
          className="replay-scrub"
          min={min}
          max={max || min + 1}
          step="0.05"
          value={now}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Replay position"
        />
        <span className="muted replay-time">{clock(now)} / {clock(max)}</span>
        <Segmented size="sm" value={speed} onChange={setSpeed} options={SPEEDS} />
        {hasVideo && calibration && (
          <Button size="sm" variant={overlay ? 'secondary' : 'ghost'} icon="crosshair" onClick={() => setOverlay((o) => !o)} title="Show which tracked robot is which on the video">{overlay ? 'Hide labels' : 'Show labels'}</Button>
        )}
        {onMarkStart && hasVideo && (
          <Button size="sm" variant="ghost" icon="flag" loading={busy} onClick={() => { setPlaying(false); onMarkStart(now); }} title="Re-track using this moment as the start of auto">Match starts here</Button>
        )}
        <Button size="sm" variant="ghost" icon={theater ? 'x' : 'eye'} onClick={toggleTheater}>{theater ? 'Exit' : 'Full screen'}</Button>
      </div>
      <p className="muted replay-help">Space play/pause · ←/→ skip 5 s (Shift: 1 s) · F full screen</p>
    </div>
  );
}
