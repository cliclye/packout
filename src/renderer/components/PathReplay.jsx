import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FieldView from './FieldView';
import { Button, Segmented } from './ui';

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

/**
 * Plays tracked paths back over time, optionally next to the source video.
 * When a video is available it is the clock, so the dots on the field and the
 * robots in the footage move together; otherwise a timer drives the field alone.
 *
 * Space plays/pauses, ←/→ skip 5 s (with Shift: 1 s), F toggles full screen.
 */
export default function PathReplay({ runs, colors, labels, filter, videoSrc, onMarkStart, busy }) {
  const [t, setT] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState('1');
  const [hasVideo, setHasVideo] = useState(Boolean(videoSrc));
  const [duration, setDuration] = useState(0);
  const [theater, setTheater] = useState(false);
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
        )}
        <div className="replay-field">
          <FieldView runs={runs} colors={colors} labels={labels} filter={filter} mode="paths" time={now} />
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
        {onMarkStart && hasVideo && (
          <Button size="sm" variant="ghost" icon="flag" loading={busy} onClick={() => { setPlaying(false); onMarkStart(now); }} title="Re-track using this moment as the start of auto">Match starts here</Button>
        )}
        <Button size="sm" variant="ghost" icon={theater ? 'x' : 'eye'} onClick={toggleTheater}>{theater ? 'Exit' : 'Full screen'}</Button>
      </div>
      <p className="muted replay-help">Space play/pause · ←/→ skip 5 s (Shift: 1 s) · F full screen</p>
    </div>
  );
}
