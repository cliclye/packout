/**
 * Synthetic accuracy benchmark for the robot tracker.
 *
 *   node test/track-sim.test.js [seeds=8] [--no-color]
 *   TRACKER='{"gate":20}' overrides tracker settings
 *
 * Simulates six robots (random driving, bumping, pauses) and the detector's
 * failure modes (missed boxes, occlusion bursts when robots overlap, noisy and
 * outlier boxes, short-lived false positives), runs both trackers on the
 * resulting detections and scores them against the known true paths.
 *
 * It exits non-zero if the improved tracker is not clearly better than the
 * legacy one, so regressions in tracking quality fail loudly.
 */
const assert = require('assert');
const scout = require('../src/main/scout');

const WITH_COLOR = !process.argv.includes('--no-color');
const TRACKER = process.env.TRACKER ? JSON.parse(process.env.TRACKER) : undefined;
// OFF=outage,miss,ghost,crowd switches individual failure modes off, to see which one hurts.
const OFF = new Set((process.env.OFF || '').split(','));
const FPS = 30;
const DURATION = 150;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

function simulate(seed) {
  const r = rng(seed);
  const N = 6;
  // metric coordinates u = x, v = y / 2
  const bots = Array.from({ length: N }, (_, i) => {
    const left = i < 3;
    return {
      u: left ? 0.12 + 0.1 * r() : 0.78 + 0.1 * r(),
      v: 0.05 + 0.14 * (i % 3) + 0.03 * r(),
      vu: 0, vv: 0,
      goal: null, pause: 0,
      width: 0.06 + 0.025 * r(),
      // colour signature: alliance colour plus a per-robot offset
      color: [left ? 0.8 : 0.15, 0.3, left ? 0.15 : 0.8].map((c) => c + 0.12 * gauss(r)),
    };
  });
  const truth = bots.map(() => []);
  const frames = [];
  const dt = 1 / FPS;
  const ghosts = [];
  const outage = bots.map(() => 0);

  for (let f = 0; f < DURATION * FPS; f++) {
    const time = f * dt;
    // --- physics
    bots.forEach((b) => {
      if (b.pause > 0) { b.pause -= dt; b.vu *= 0.9; b.vv *= 0.9; }
      else {
        if (!b.goal || Math.hypot(b.goal.u - b.u, b.goal.v - b.v) < 0.03) {
          b.goal = { u: 0.05 + 0.9 * r(), v: 0.03 + 0.44 * r() };
          b.pause = r() < 0.5 ? 3 * r() : 0;
        }
        const du = b.goal.u - b.u; const dv = b.goal.v - b.v; const d = Math.hypot(du, dv) || 1;
        const maxV = 0.2;
        b.vu += (du / d) * 0.18 * dt + 0; b.vv += (dv / d) * 0.18 * dt;
        const sp = Math.hypot(b.vu, b.vv);
        if (sp > maxV) { b.vu *= maxV / sp; b.vv *= maxV / sp; }
      }
      b.u += b.vu * dt; b.v += b.vv * dt;
      b.u = Math.min(0.98, Math.max(0.02, b.u)); b.v = Math.min(0.49, Math.max(0.01, b.v));
    });
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const du = bots[j].u - bots[i].u; const dv = bots[j].v - bots[i].v; const d = Math.hypot(du, dv);
      if (d < 0.04 && d > 0) { const push = (0.04 - d) / 2; bots[i].u -= (du / d) * push; bots[i].v -= (dv / d) * push; bots[j].u += (du / d) * push; bots[j].v += (dv / d) * push; }
    }
    bots.forEach((b, i) => truth[i].push({ time, u: b.u, v: b.v }));

    // --- detector
    const dets = [];
    bots.forEach((b, i) => {
      if (outage[i] > 0) { outage[i] -= dt; return; }
      if (!OFF.has('outage') && r() < dt / 10) { outage[i] = 0.2 + 1.3 * r(); return; }
      const crowded = bots.some((o, j) => j !== i && Math.hypot(o.u - b.u, o.v - b.v) < 0.07);
      if (!OFF.has('miss') && r() > (crowded && !OFF.has('crowd') ? 0.6 : 0.95)) return;
      const outlier = r() < 0.03;
      const s = outlier ? 6 : 1;
      const u = b.u + gauss(r) * 0.009 * s;
      const v = b.v + gauss(r) * 0.006 * s;
      const persp = 0.55 + 1.0 * (b.v / 0.5);
      const w = b.width * persp * (1 + gauss(r) * 0.06);
      const conf = Math.min(0.97, Math.max(0.4, (crowded ? 0.6 : 0.85) + gauss(r) * 0.08));
      const fs = (crowded ? 0.1 : 0.04);
      dets.push({ id: i, u, v, w, conf, f: WITH_COLOR ? b.color.map((c) => c + gauss(r) * fs) : undefined });
    });
    if (!OFF.has('ghost') && r() < 0.004) ghosts.push({ u: r(), v: 0.5 * r(), vu: 0.02 * gauss(r), vv: 0.01 * gauss(r), life: 1 + 4 * r() });
    for (let g = ghosts.length - 1; g >= 0; g--) {
      const gh = ghosts[g];
      gh.u += gh.vu * dt; gh.v += gh.vv * dt; gh.life -= dt;
      if (gh.life <= 0) ghosts.splice(g, 1);
      else if (r() < 0.85) dets.push({ u: gh.u, v: gh.v, w: 0.04, conf: 0.4 + 0.2 * r(), f: WITH_COLOR ? [r(), r(), r()] : undefined });
    }
    if (!dets.length) continue; // the detector writes nothing for empty frames
    dets.sort((a, b) => b.conf - a.conf);
    frames.push(dets.map((d) => {
      const p = new scout.Point(d.u, d.v * 2, time);
      p.conf = d.conf; p.w = d.w; p.id = d.id; if (d.f) p.f = d.f;
      return p;
    }));
  }
  const frameTimes = frames.map((f) => f[0].time);
  return { truth, frames, frameTimes };
}

function score(history, truthTrack, others, t0) {
  // sample the estimate by holding the last value, so a tracker with gaps pays for them
  let k = 0;
  const errs = [];
  let idWrong = 0; let n = 0; let stale = 0;
  for (const tp of truthTrack) {
    if (tp.time < t0) continue;
    while (k + 1 < history.length && history[k + 1].time <= tp.time) k++;
    const h = history[k];
    if (!h || h.time > tp.time + 0.5) continue;
    const e = Math.hypot(h.x - tp.u, (h.y - tp.v * 2) / 2);
    errs.push(e); n++;
    if (tp.time - h.time > 0.1) stale++;
    const nearestOther = Math.min(...others.map((o) => Math.hypot(h.x - o[truthTrack.indexOf(tp)].u, (h.y - o[truthTrack.indexOf(tp)].v * 2) / 2)));
    if (e > 0.05 && nearestOther < e) idWrong++;
  }
  errs.sort((a, b) => a - b);
  let jumps = 0;
  for (let i = 1; i < history.length; i++) if (Math.hypot(history[i].x - history[i - 1].x, (history[i].y - history[i - 1].y) / 2) > 0.03) jumps++;
  return {
    mean: errs.reduce((a, b) => a + b, 0) / Math.max(1, n),
    p95: errs[Math.floor(errs.length * 0.95)] || 0,
    idWrong: idWrong / Math.max(1, n),
    stale: stale / Math.max(1, n),
    jumps,
    samples: history.length,
  };
}

const seeds = Number(process.argv[2]) || 8;
const agg = { legacy: [], improved: [] };
for (let s = 1; s <= seeds; s++) {
  const { truth, frames, frameTimes } = simulate(s * 101);
  const autoFrames = new Set();
  for (const legacy of [true, false]) {
    const teams = ['a', 'b', 'c', 'd', 'e', 'f'];
    let res;
    try {
      res = scout.trackRobots(frames, autoFrames, teams, { redOnLeft: false, legacy, frameTimes, tracker: TRACKER });
    } catch (e) { console.log('seed', s, legacy ? 'legacy' : 'improved', 'failed:', e.message); continue; }
    // The tracker numbers robots by detection order at the start; map each to the nearest true robot there.
    const first = frameTimes[res.firstFrameIndex];
    const at = (i) => truth[i].reduce((best, p) => (Math.abs(p.time - first) < Math.abs(best.time - first) ? p : best));
    res.robots.forEach((rb, idx) => {
      const h0 = rb.history[0];
      let bi = 0; let bd = Infinity;
      truth.forEach((_, i) => { const d = Math.hypot(h0.x - at(i).u, (h0.y - at(i).v * 2) / 2); if (d < bd) { bd = d; bi = i; } });
      const others = truth.filter((_, i) => i !== bi);
      const m = score(rb.history, truth[bi], others.map((o) => o), first);
      agg[legacy ? 'legacy' : 'improved'].push(m);
    });
  }
}
const avg = (rows, k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
console.log(`seeds=${seeds}, robots scored per tracker: ${agg.improved.length}`);
console.log('metric                 legacy    improved');
const out = {};
for (const [k, label] of [['mean', 'mean error (fw)'], ['p95', '95% error (fw)'], ['idWrong', 'wrong-robot time'], ['stale', 'stale (>0.1s) time'], ['jumps', 'jumps >0.03/robot'], ['samples', 'samples/robot']]) {
  const a = avg(agg.legacy, k); const b = avg(agg.improved, k);
  out[k] = [a, b];
  console.log(label.padEnd(22), a.toFixed(4).padStart(8), b.toFixed(4).padStart(10));
}
assert(out.mean[1] < out.mean[0], 'improved tracker should have lower mean error');
assert(out.idWrong[1] <= out.idWrong[0], 'improved tracker should not swap robots more');
assert(out.jumps[1] <= out.jumps[0], 'improved tracker should not jump more');
console.log('ok');
