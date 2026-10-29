import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FieldView from './FieldView';
import { Button, Segmented, fmt } from './ui';

const SPEEDS = [
  { value: '0.5', label: '0.5×' },
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
  { value: '4', label: '4×' },
];

/**
 * Plays tracked paths back over time, optionally next to the source video.
 * When a video is available it is the clock, so the dots on the field and the
 * robots in the footage move together; otherwise a timer drives the field alone.
 */
export default function PathReplay({ runs, colors, labels, filter, videoSrc }) {
  const [t, setT] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState('1');
  const [hasVideo, setHasVideo] = useState(Boolean(videoSrc));
  const videoRef = useRef(null);
  const clock = useRef({ last: 0 });
  const tRef = useRef(null);

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

  tRef.current = t;
  const now = t === null ? start : Math.min(Math.max(t, start), end);
  const rate = Number(speed);

  const seek = useCallback((time) => {
    const v = videoRef.current;
    if (v && hasVideo) v.currentTime = time;
    setT(time);
  }, [hasVideo]);

  useEffect(() => { setHasVideo(Boolean(videoSrc)); }, [videoSrc]);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = rate; }, [rate, hasVideo]);

  useEffect(() => {
    if (!playing) return undefined;
    const v = videoRef.current;
    if (v && hasVideo) v.play().catch(() => setPlaying(false));
    clock.current.last = performance.now();
    let raf;
    const tick = (ts) => {
      let next;
      if (v && hasVideo) {
        next = v.currentTime;
      } else {
        next = (tRef.current === null ? start : tRef.current) + ((ts - clock.current.last) / 1000) * rate;
        clock.current.last = ts;
      }
      if (next >= end) {
        setT(end);
        setPlaying(false);
        return;
      }
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (v) v.pause();
    };
  }, [playing, hasVideo, rate, start, end]);

  const toggle = () => {
    if (!playing && now >= end) seek(start);
    setPlaying(!playing);
  };

  return (
    <div className="stack">
      <div className="replay-grid" style={{ display: 'grid', gridTemplateColumns: hasVideo ? 'minmax(0, 1fr) minmax(0, 1fr)' : '1fr', gap: 12, alignItems: 'start' }}>
        {hasVideo && (
          <video
            ref={videoRef}
            src={videoSrc}
            muted
            playsInline
            preload="auto"
            style={{ width: '100%', borderRadius: 10, background: '#000' }}
            onLoadedMetadata={() => { if (videoRef.current) videoRef.current.currentTime = now; }}
            onError={() => setHasVideo(false)}
          />
        )}
        <FieldView runs={runs} colors={colors} labels={labels} filter={filter} mode="paths" time={now} />
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <Button size="sm" icon={playing ? 'pause' : 'play'} onClick={toggle}>{playing ? 'Pause' : now >= end ? 'Replay' : 'Play'}</Button>
        <input
          type="range"
          className="grow"
          min={start}
          max={end}
          step="0.05"
          value={now}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Replay position"
          style={{ flex: 1 }}
        />
        <span className="muted" style={{ minWidth: 92, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(now, 1)}s / {fmt(end, 0)}s</span>
        <Segmented size="sm" value={speed} onChange={setSpeed} options={SPEEDS} />
      </div>
    </div>
  );
}
