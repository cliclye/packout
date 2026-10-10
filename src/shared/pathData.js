/**
 * Robot-path helpers shared by the main process (CSV import) and the renderer
 * (drawing). Mirrors scouting-ai/Visualization.java so paths look identical.
 *
 * Coordinates are field-relative: x,y in 0..1 with (0,0) at the top-left of the
 * field image after AIScout's red-on-left mirroring.
 */

// Visualization.MIN_DIST / TIME_STEP
const MIN_DIST = 0.0089;
const TIME_STEP = 0.167;

function distance(a, b) {
  // y spans half the physical distance of x (see Point.distanceTo in AIScout)
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow((a.y - b.y) / 2, 2));
}

/**
 * Parses scouting-ai CSV text. A line of dashes starts a new match; rows are
 * `isAuto,x,y,time`. Files without separators are a single run.
 * @returns {{isAuto:boolean,x:number,y:number,time:number}[][]}
 */
function parsePathCsv(text) {
  const runs = [];
  let current = [];
  const flush = () => {
    if (current.length) runs.push(current);
    current = [];
  };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('-')) {
      flush();
      continue;
    }
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length !== 4) continue;
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const time = Number(parts[3]);
    if (![x, y, time].every(Number.isFinite)) continue;
    const flag = parts[0].toLowerCase();
    current.push({ isAuto: flag === 'true' || flag === '1', x, y, time });
  }
  flush();
  return runs;
}

/**
 * Port of the point filtering/interpolation in Visualization.main: drops
 * near-duplicate points and resamples to a fixed time step. Keeps files small
 * (a 2:40 match at 30fps -> ~1000 points) without changing how the path looks.
 */
function resamplePath(samples, { minDist = MIN_DIST, step = TIME_STEP } = {}) {
  const out = [];
  let currentTime = 0;
  for (const s of samples) {
    if (!out.length) {
      currentTime = s.time;
      out.push({ isAuto: s.isAuto, x: s.x, y: s.y, time: s.time });
      continue;
    }
    const last = out[out.length - 1];
    if (distance(s, last) < minDist) continue;
    const span = s.time - last.time;
    while (currentTime < s.time) {
      const f = span > 0 ? (currentTime - last.time) / span : 1;
      out.push({
        isAuto: s.isAuto,
        x: last.x + (s.x - last.x) * f,
        y: last.y + (s.y - last.y) * f,
        time: currentTime,
      });
      currentTime += step;
    }
  }
  return out;
}

function startedLeft(samples) {
  return samples.length > 0 && samples[0].x < 0.5;
}

/** Same bookkeeping as Visualization's gaussian heatmap, returned as a density grid. */
function buildHeatGrid(runs, filter, w = 200, h = 120, radius = 6) {
  const density = new Float32Array(w * h);
  for (const run of runs) {
    for (const p of run.samples) {
      if (filter === 'auto' && !p.isAuto) continue;
      if (filter === 'tele' && p.isAuto) continue;
      const cx = Math.min(w - 1, Math.max(0, Math.floor(p.x * w)));
      const cy = Math.min(h - 1, Math.max(0, Math.floor(p.y * h)));
      density[cy * w + cx] += 1;
    }
  }
  const sigma = radius / 2.5;
  const kernel = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = Math.min(w - 1, Math.max(0, x + k));
        v += density[y * w + sx] * kernel[k + radius];
      }
      tmp[y * w + x] = v;
    }
  }
  const out = new Float32Array(w * h);
  let max = 0;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = Math.min(h - 1, Math.max(0, y + k));
        v += tmp[sy * w + x] * kernel[k + radius];
      }
      out[y * w + x] = v;
      if (v > max) max = v;
    }
  }
  return { w, h, data: out, max };
}

module.exports = { MIN_DIST, TIME_STEP, parsePathCsv, resamplePath, startedLeft, buildHeatGrid, distance };
