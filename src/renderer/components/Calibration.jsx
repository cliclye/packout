import React, { useEffect, useRef, useState } from 'react';

const CORNERS = [
  ['topLeft', 'TL'],
  ['bottomLeft', 'BL'],
  ['topRight', 'TR'],
  ['bottomRight', 'BR'],
];

/**
 * Field calibration: drag the four yellow handles onto the corners of the field
 * as seen in the video frame. Same corner order and 0..1 coordinates as
 * scouting-ai's FieldCalibrator (TL, BL, TR, BR).
 */
export default function Calibration({ imageSrc, corners, onChange, redOnLeft = true, onImageReady }) {
  const canvasRef = useRef(null);
  const [img, setImg] = useState(null);
  const [failed, setFailed] = useState(false);
  const [drag, setDrag] = useState(-1);

  useEffect(() => {
    setImg(null);
    setFailed(false);
    if (!imageSrc) return undefined;
    const i = new Image();
    i.onload = () => {
      setImg(i);
      onImageReady && onImageReady(i);
    };
    i.onerror = () => setFailed(true);
    i.src = imageSrc;
    return () => {
      i.onload = null;
      i.onerror = null;
    };
  }, [imageSrc]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = img ? Math.min(img.naturalWidth, 1280) : 1280;
    const H = img ? Math.round((W * img.naturalHeight) / img.naturalWidth) : 720;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#16181f';
    ctx.fillRect(0, 0, W, H);
    if (img) ctx.drawImage(img, 0, 0, W, H);

    const pt = (k) => [corners[k].x * W, corners[k].y * H];
    const [tl, bl, tr, br] = ['topLeft', 'bottomLeft', 'topRight', 'bottomRight'].map(pt);
    // translucent field fill + outline
    ctx.beginPath();
    ctx.moveTo(...tl); ctx.lineTo(...tr); ctx.lineTo(...br); ctx.lineTo(...bl); ctx.closePath();
    ctx.fillStyle = 'rgba(52, 211, 153, 0.12)';
    ctx.fill();
    ctx.lineWidth = Math.max(3, W / 400);
    ctx.strokeStyle = '#34d399';
    ctx.stroke();

    // alliance side labels, as drawn by AIScout's confirmation window
    const fs = Math.round(W / 40);
    ctx.font = `700 ${fs}px -apple-system, system-ui, sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,.65)';
    const labels = redOnLeft ? [['Red alliance side', '#ff5a5f'], ['Blue alliance side', '#4d8dff']] : [['Blue alliance side', '#4d8dff'], ['Red alliance side', '#ff5a5f']];
    labels.forEach(([text, color], i) => {
      const x = W * (i === 0 ? 0.06 : 0.56);
      const y = H * 0.1;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    });

    CORNERS.forEach(([k, label], i) => {
      const [x, y] = pt(k);
      const r = Math.max(9, W / 110);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = drag === i ? '#fff176' : '#ffd60a';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#000';
      ctx.stroke();
      ctx.font = `700 ${Math.round(W / 70)}px -apple-system, system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.strokeText(label, x + r + 5, y + 5);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + r + 5, y + 5);
    });
  }, [img, corners, redOnLeft, drag]);

  const rel = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height, rect };
  };

  const onDown = (e) => {
    const { x, y, rect } = rel(e);
    let best = -1;
    let bestD = Infinity;
    CORNERS.forEach(([k], i) => {
      const dx = (corners[k].x - x) * rect.width;
      const dy = (corners[k].y - y) * rect.height;
      const d = Math.hypot(dx, dy);
      if (d < bestD && d < 28) { bestD = d; best = i; }
    });
    if (best >= 0) {
      setDrag(best);
      canvasRef.current.setPointerCapture(e.pointerId);
    }
  };
  const onMove = (e) => {
    if (drag < 0) return;
    const { x, y } = rel(e);
    onChange({ ...corners, [CORNERS[drag][0]]: { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) } });
  };
  const onUp = () => setDrag(-1);

  return (
    <div className="calib">
      <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ cursor: drag >= 0 ? 'grabbing' : 'crosshair', touchAction: 'none' }} />
      {failed && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', lineHeight: 1.4, padding: 20, textAlign: 'center' }}>Could not load a preview frame.</div>}
    </div>
  );
}
