import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Button, Icon } from './ui';

/**
 * Full-screen looping QR display. The phone camera collects every frame, so the
 * data crosses with no Wi-Fi, hotspot or cable. White background on purpose: scanners
 * need the contrast even when the app is in dark mode.
 */
export default function QrStream({ frames, chunk = 450, onClose, onRebuild, title = 'Show this to the phone camera' }) {
  const canvas = useRef(null);
  const [i, setI] = useState(0);
  const [fps, setFps] = useState(3);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || frames.length < 2) return undefined;
    const id = setInterval(() => setI((x) => (x + 1) % frames.length), 1000 / fps);
    return () => clearInterval(id);
  }, [fps, paused, frames.length]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!canvas.current || !frames[i]) return;
    // Whole pixels per module keeps the edges crisp (a fractional scale blurs dense codes), and a
    // 4-module quiet zone is what scanners expect.
    const margin = 4;
    const target = Math.max(320, Math.min(window.innerHeight - 220, window.innerWidth - 80, 800));
    try {
      const modules = QRCode.create(frames[i], { errorCorrectionLevel: 'M' }).modules.size;
      const scale = Math.max(3, Math.floor(target / (modules + margin * 2)));
      QRCode.toCanvas(canvas.current, frames[i], { errorCorrectionLevel: 'M', margin, scale, color: { dark: '#000000', light: '#ffffff' } }).catch(() => {});
    } catch { /* frame too large for a QR; the builder keeps chunks small enough that this does not happen */ }
  }, [i, frames]);

  return (
    <div className="qrstream">
      <div className="qrstream-head">
        <div>
          <h2>{title}</h2>
          <p>Open <b>Packout Coach → Data → Scan from computer screen</b>. Hold the phone 20–30 cm away until all boxes turn green (tap the code on the phone to focus; turn this screen's brightness up). It loops, so start anywhere.</p>
        </div>
        <Button icon="x" onClick={onClose}>Close</Button>
      </div>
      <canvas ref={canvas} className="qrstream-canvas" />
      <div className="qrstream-dots">{frames.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
      <div className="qrstream-controls">
        <span className="muted">Frame {i + 1} / {frames.length}</span>
        <Button size="sm" onClick={() => setPaused(!paused)} icon={paused ? 'play' : 'stop'}>{paused ? 'Resume' : 'Pause'}</Button>
        {[2, 3, 5].map((f) => <Button key={f} size="sm" variant={fps === f ? 'primary' : 'secondary'} onClick={() => setFps(f)}>{f}/s</Button>)}
        {onRebuild && [[300, 'Easier'], [450, 'Standard'], [700, 'Denser']].map(([c, label]) => (
          <Button key={c} size="sm" variant={chunk === c ? 'primary' : 'secondary'} onClick={() => onRebuild(c)} title={c === 300 ? 'More, simpler codes — easiest for a cheap or shaky camera' : c === 700 ? 'Fewer, denser codes — fastest on a good camera' : 'Balanced'}>{label}</Button>
        ))}
        {onRebuild && <Button size="sm" icon="rotate" onClick={() => onRebuild(chunk)}>Refresh data</Button>}
      </div>
    </div>
  );
}
