/**
 * Offline robot tracker: Kalman filtering + joint (Hungarian) association +
 * Rauch-Tung-Striebel smoothing.
 *
 * Why this exists: the original scouting-ai tracker matches every frame to the
 * robot's *last* position and silently skips frames where a robot is not
 * detected, which leaves gaps and lets paths jump whenever two robots cross or
 * a box flickers. Here every robot carries a constant-velocity motion model, so
 *
 *   - association uses where the robot *should* be, scaled by how uncertain we
 *     are (Mahalanobis distance), not just where it last was;
 *   - missed detections are coasted through instead of dropped;
 *   - because the whole video is available, a backward smoothing pass uses
 *     future detections to repair the past, and the result is sampled on a
 *     uniform time grid: one point per frame, no gaps, no teleports.
 *
 * Field coordinates are the scouting-ai ones (x, y in 0..1). The Y axis spans
 * half the physical distance of X, so filtering happens in (u, v) = (x, y / 2)
 * where distance is ordinary Euclidean distance.
 */

const { hungarian } = require('./hungarian');

const DEFAULTS = {
  accelSigma: 0.2,     // field-widths / s^2 (a robot reaching ~0.25 fw/s in about a second)
  measSigmaU: 0.012,   // detection noise, field widths
  measSigmaV: 0.008,
  gate: 16,            // Mahalanobis^2 gate (2 dof, p ~ 3e-4)
  sizeWeight: 12,      // cost of a robot's box width changing by a factor e
  featWeight: 3,       // cost of a robot's colour signature differing by featSigma on average
  featSigma: 0.12,
  dedupe: 0.012,       // detections closer than this (metric) are the same robot
  coastDamping: 0.3,   // seconds before a robot lost from view is assumed to slow down
  maxPredict: 4,       // seconds a robot may coast before it is considered lost
};

/** One independent position/velocity filter (u and v do not interact). */
class Axis {
  constructor(p, v, p0, v0) {
    this.p = p;
    this.v = v;
    this.P00 = p0;
    this.P01 = 0;
    this.P11 = v0;
  }

  predict(dt, q) {
    this.p += this.v * dt;
    const { P00, P01, P11 } = this;
    this.P00 = P00 + 2 * dt * P01 + dt * dt * P11 + (q * dt ** 4) / 4;
    this.P01 = P01 + dt * P11 + (q * dt ** 3) / 2;
    this.P11 = P11 + q * dt * dt;
  }

  update(z, r) {
    const s = this.P00 + r;
    const k0 = this.P00 / s;
    const k1 = this.P01 / s;
    const y = z - this.p;
    this.p += k0 * y;
    this.v += k1 * y;
    const P01 = this.P01;
    this.P11 -= k1 * P01;
    this.P01 = (1 - k0) * P01;
    this.P00 = (1 - k0) * this.P00;
  }
}

class Track {
  constructor(team, start, cfg) {
    this.team = team;
    this.cfg = cfg;
    this.u = new Axis(start.x, 0, cfg.measSigmaU ** 2, 0.05);
    this.v = new Axis(start.y / 2, 0, cfg.measSigmaV ** 2, 0.05);
    this.width = start.w || 0;
    this.feat = start.f ? start.f.slice() : null;
    this.time = start.time;
    this.missed = 0;
    this.log = []; // per frame: filtered + predicted state for the smoother
    this.snapshot(start.time, true, null);
  }

  predictTo(time) {
    const dt = time - this.time;
    if (dt <= 0) return 0;
    const q = this.cfg.accelSigma ** 2;
    // A robot nobody has seen for a while has probably stopped or been pushed
    // around; bleed off the velocity so the prediction does not fly away.
    if (this.missed * dt > this.cfg.coastDamping) {
      const k = Math.exp(-dt / 0.6);
      this.u.v *= k;
      this.v.v *= k;
    }
    this.u.predict(dt, q);
    this.v.predict(dt, q);
    this.time = time;
    return dt;
  }

  /** Squared Mahalanobis distance of a detection from the (already predicted) state. */
  mahalanobis(det) {
    const ru = this.cfg.measSigmaU ** 2 / confScale(det);
    const rv = this.cfg.measSigmaV ** 2 / confScale(det);
    const du = det.x - this.u.p;
    const dv = det.y / 2 - this.v.p;
    return (du * du) / (this.u.P00 + ru) + (dv * dv) / (this.v.P00 + rv);
  }

  sizeCost(det) {
    if (!(this.width > 0) || !(det.w > 0)) return 0;
    const l = Math.log(det.w / this.width);
    return this.cfg.sizeWeight * l * l;
  }

  /** How different a detection's colour signature is from this robot's (0 when unknown). */
  featCost(det) {
    if (!this.feat || !det.f || det.f.length !== this.feat.length) return 0;
    let sum = 0;
    for (let i = 0; i < this.feat.length; i++) sum += ((det.f[i] - this.feat[i]) / this.cfg.featSigma) ** 2;
    return (this.cfg.featWeight * sum) / this.feat.length;
  }

  update(det) {
    const s = confScale(det);
    this.u.update(det.x, this.cfg.measSigmaU ** 2 / s);
    this.v.update(det.y / 2, this.cfg.measSigmaV ** 2 / s);
    if (det.w > 0) this.width = this.width > 0 ? 0.8 * this.width + 0.2 * det.w : det.w;
    if (det.f && this.feat && det.f.length === this.feat.length) {
      for (let i = 0; i < this.feat.length; i++) this.feat[i] = 0.9 * this.feat[i] + 0.1 * det.f[i];
    } else if (det.f && !this.feat) {
      this.feat = det.f.slice();
    }
    this.missed = 0;
  }

  snapshot(time, measured, pred) {
    this.log.push({
      time,
      measured,
      f: { pu: this.u.p, vu: this.u.v, a: [this.u.P00, this.u.P01, this.u.P11], pv: this.v.p, vv: this.v.v, b: [this.v.P00, this.v.P01, this.v.P11] },
      pred,
    });
  }
}

// Boxes with low confidence say less about where the robot is.
function confScale(det) {
  const c = Math.max(Number.isFinite(det.conf) ? det.conf : 0.7, 0.3);
  return c * c;
}

/** Drops boxes that sit on top of a stronger one (frames are sorted by confidence). */
function dedupe(dets, minDist) {
  const kept = [];
  for (const d of dets) {
    if (kept.some((k) => Math.hypot(k.x - d.x, (k.y - d.y) / 2) < minDist)) continue;
    kept.push(d);
  }
  return kept;
}

/**
 * Tracks `starts.length` robots through `frames` (arrays of detections with
 * x, y, time, conf, w) beginning at `startIndex`.
 *
 * @param {object[][]} frames        per-frame detections, time-ordered
 * @param {object[]}   starts        one start point per robot, in team order
 * @param {string[]}   teams         team label per robot
 * @param {number}     startIndex    frame the starts were taken from
 * @param {Set<number>} autoFrames   frame indices that are autonomous
 * @param {object}     opts          { redOnLeft, onProgress, ...DEFAULTS overrides }
 * @returns {{team:string, history:{isAuto:boolean,x:number,y:number,time:number,est:boolean}[]}[]}
 */
function trackOffline(frames, starts, teams, startIndex, autoFrames, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const { redOnLeft = true, onProgress = null } = opts;
  const frameTime = [];
  let t = frames[startIndex] && frames[startIndex][0] ? frames[startIndex][0].time : 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.length) t = f[0].time;
    frameTime.push(t);
  }

  const pass = runPass(frames, starts, teams, startIndex, cfg, onProgress);

  return pass.tracks.map((tr) => ({
    team: tr.team,
    history: sampleUniform(tr.log, frameTime, startIndex, autoFrames, redOnLeft),
  }));
}

/** Greedy frame-by-frame association with a Kalman filter per robot. */
function runPass(frames, starts, teams, startIndex, cfg, onProgress) {
  const tracks = starts.map((s, i) => new Track(teams[i], s, cfg));
  const last = frames.length - 1;

  for (let i = startIndex + 1; i < frames.length; i++) {
    if (onProgress && (i % 250 === 0 || i === last)) onProgress(last > 0 ? i / last : 1);
    const dets = frames[i].length ? dedupe(frames[i], cfg.dedupe) : [];
    const time = dets.length ? dets[0].time : null;
    if (time === null || time <= tracks[0].time) continue;

    // The predicted state is recorded (for smoothing) before the measurement update.
    for (const tr of tracks) tr.predictTo(time);
    const preds = tracks.map((tr) => ({
      pu: tr.u.p, vu: tr.u.v, a: [tr.u.P00, tr.u.P01, tr.u.P11],
      pv: tr.v.p, vv: tr.v.v, b: [tr.v.P00, tr.v.P01, tr.v.P11],
    }));

    const BIG = 1e6;
    const cost = tracks.map((tr) => dets.map((d) => {
      const m = tr.mahalanobis(d);
      return m > cfg.gate ? BIG : m + tr.sizeCost(d) + tr.featCost(d);
    }));
    const asg = hungarian(cost).map((j, k) => (j >= 0 && cost[k][j] < BIG ? j : -1));
    if (cfg.onFrame) cfg.onFrame(i, time, asg, dets, tracks);
    tracks.forEach((tr, k) => {
      if (asg[k] >= 0) tr.update(dets[asg[k]]);
      else tr.missed++;
      tr.snapshot(time, asg[k] >= 0, preds[k]);
    });
  }
  return { tracks };
}

// ----------------------------------------------------------- smoothing -----

/** Rauch-Tung-Striebel backward pass for one axis; returns smoothed [p, v] per log entry. */
function smoothAxis(log, axis) {
  const n = log.length;
  const key = axis === 'u' ? ['pu', 'vu', 'a'] : ['pv', 'vv', 'b'];
  const ps = new Array(n);
  const vs = new Array(n);
  ps[n - 1] = log[n - 1].f[key[0]];
  vs[n - 1] = log[n - 1].f[key[1]];
  for (let k = n - 2; k >= 0; k--) {
    const f = log[k].f;
    const next = log[k + 1];
    const dt = next.time - log[k].time;
    const pr = next.pred;
    if (!pr || dt <= 0) { ps[k] = f[key[0]]; vs[k] = f[key[1]]; continue; }
    const [P00, P01, P11] = f[key[2]];
    const [Q00, Q01, Q11] = pr[key[2]]; // predicted covariance at k+1
    // C = P F^T Pp^-1 with F = [[1, dt], [0, 1]]
    const m00 = P00 + dt * P01; const m01 = P01 + dt * P11; // (P F^T)[0][*]
    const m10 = P01; const m11 = P11; // (P F^T)[1][*]
    const det = Q00 * Q11 - Q01 * Q01;
    if (!(Math.abs(det) > 1e-18)) { ps[k] = f[key[0]]; vs[k] = f[key[1]]; continue; }
    const i00 = Q11 / det; const i01 = -Q01 / det; const i11 = Q00 / det;
    const c00 = m00 * i00 + m01 * i01; const c01 = m00 * i01 + m01 * i11;
    const c10 = m10 * i00 + m11 * i01; const c11 = m10 * i01 + m11 * i11;
    const dp = ps[k + 1] - pr[key[0]];
    const dv = vs[k + 1] - pr[key[1]];
    ps[k] = f[key[0]] + c00 * dp + c01 * dv;
    vs[k] = f[key[1]] + c10 * dp + c11 * dv;
  }
  return { ps, vs };
}

function hermite(p0, v0, p1, v1, h, s) {
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * h * v0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * h * v1;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Smooths a track and samples it on an even time grid (one point per video frame). */
function sampleUniform(log, frameTime, startIndex, autoFrames, redOnLeft) {
  // Drop log entries whose time did not advance (defensive) and the trailing run of
  // coasted frames: nothing was seen after it, so extending the path would be a guess.
  let n = log.length;
  while (n > 1 && !log[n - 1].measured) n--;
  const L = log.slice(0, n);
  if (L.length < 2) return [];
  const su = smoothAxis(L, 'u');
  const sv = smoothAxis(L, 'v');

  const dts = [];
  for (let k = 1; k < L.length; k++) dts.push(L[k].time - L[k - 1].time);
  dts.sort((a, b) => a - b);
  const step = dts.length ? dts[Math.floor(dts.length / 2)] || 1 / 30 : 1 / 30;

  // map time -> frame index (for the auto flag) via a pointer over frameTime
  let fi = startIndex;
  const isAutoAt = (time) => {
    while (fi + 1 < frameTime.length && frameTime[fi + 1] <= time + 1e-9) fi++;
    return autoFrames.has(fi);
  };

  const out = [];
  const t0 = L[0].time;
  const t1 = L[L.length - 1].time;
  let k = 0;
  const total = Math.floor((t1 - t0) / step + 1e-9);
  for (let n2 = 0; n2 <= total; n2++) {
    const time = t0 + n2 * step;
    while (k + 2 < L.length && L[k + 1].time <= time) k++;
    const a = L[k];
    const b = L[k + 1];
    const h = b.time - a.time;
    const s = h > 0 ? Math.min(1, Math.max(0, (time - a.time) / h)) : 0;
    const u = hermite(su.ps[k], su.vs[k], su.ps[k + 1], su.vs[k + 1], h, s);
    const v = hermite(sv.ps[k], sv.vs[k], sv.ps[k + 1], sv.vs[k + 1], h, s);
    const x = clamp01(u);
    const y = clamp01(v * 2);
    const near = (s < 0.5 ? a : b).measured;
    out.push({
      isAuto: isAutoAt(time),
      x: redOnLeft ? 1 - x : x,
      y: redOnLeft ? 1 - y : y,
      time: Math.round(time * 1e4) / 1e4,
      est: !near,
    });
  }
  // The very first sample is always flagged auto, like the original tracker.
  if (out.length) out[0].isAuto = true;
  return out;
}

module.exports = { trackOffline, DEFAULTS };
