/**
 * Robot path tracking — a line-for-line port of the working scouting-ai Java
 * pipeline (AIScout / FRCRobot / Line / Point / HungarianAlgorithm).
 *
 * Input:  detections from detector.py (temp/output.json — a flat array of
 *         bounding boxes with frame ids).
 * Output: per-team position histories {isAuto, x, y, time}, identical to the
 *         rows AIScout writes into data/<team>.csv.
 *
 * Keep the behaviour in sync with scouting-ai/src; every quirk is intentional
 * (e.g. Y is halved in distanceTo, jumps faster than 1 field-unit/sec are
 * rejected, the first history row is always flagged auto).
 */

const { hungarian } = require('./hungarian');
const { trackOffline } = require('./track2');

// ---------------------------------------------------------------- geometry --

class Point {
  constructor(x, y, time = 0) {
    this.x = x;
    this.y = y;
    this.time = time;
  }

  invert() {
    return new Point(this.y, -this.x, this.time);
  }

  // Y is halved: one unit of y covers half the distance of one unit of x.
  distanceTo(other) {
    return Math.sqrt(Math.pow(this.x - other.x, 2) + Math.pow((this.y - other.y) / 2, 2));
  }
}

class Line {
  static fromPoints(p1, p2) {
    let m;
    if (p1.x === p2.x) m = (p2.y - p1.y) / ((p2.x + 0.00000000001) - p1.x);
    else m = (p2.y - p1.y) / (p2.x - p1.x);
    return new Line(m, p1.y - m * p1.x);
  }

  static fromPointSlope(p, m) {
    return new Line(m, p.y - m * p.x);
  }

  constructor(m, b) {
    this.m = m;
    this.b = b;
  }

  getY(x) {
    return this.m * x + this.b;
  }

  isAbove(p) {
    return p.y >= this.getY(p.x);
  }

  intersection(l) {
    if (this.m === l.m) return null;
    const x = (l.b - this.b) / (this.m - l.m);
    return new Point(x, this.getY(x), 0);
  }
}

// ------------------------------------------------------ pose estimation -----

/** Binary-searches the robot's field Y (0..1) between the four field corners. */
function estimateYcoord(robot, topLeft, topRight, bottomLeft, bottomRight, iterations, bound0, bound1) {
  if (iterations === 0) return (bound0 + bound1) / 2;

  if (!Line.fromPoints(topLeft, topRight).isAbove(robot)) return null;
  if (Line.fromPoints(bottomLeft, bottomRight).isAbove(robot)) return null;

  const lineLeft = Line.fromPoints(topLeft, bottomRight);
  const lineRight = Line.fromPoints(bottomLeft, topRight);
  const intersect = lineLeft.intersection(lineRight);
  if (!intersect) return null;

  const lineMid = Line.fromPointSlope(intersect, (lineLeft.m + lineRight.m) / 2);
  const leftIntersect = lineMid.intersection(Line.fromPoints(topLeft, bottomLeft));
  const rightIntersect = lineMid.intersection(Line.fromPoints(topRight, bottomRight));
  if (!leftIntersect || !rightIntersect) return null;

  const mid = (bound0 + bound1) / 2;
  if (!lineMid.isAbove(robot)) {
    return estimateYcoord(robot, topLeft, topRight, leftIntersect, rightIntersect, iterations - 1, bound0, mid);
  }
  return estimateYcoord(robot, leftIntersect, rightIntersect, bottomLeft, bottomRight, iterations - 1, mid, bound1);
}

function estimateXcoord(robot, topLeft, topRight, bottomLeft, bottomRight, iterations, bound0, bound1) {
  const result = estimateYcoord(
    robot.invert(), topRight.invert(), bottomRight.invert(),
    topLeft.invert(), bottomLeft.invert(), iterations, bound0, bound1
  );
  return result === null ? null : 1 - result;
}

// ------------------------------------------------------------ calibration ---

/**
 * Corner order everywhere: TL, BL, TR, BR as {x,y} in 0..1 of the video frame
 * (same order as scouting-ai/calibration.txt).
 */
const DEFAULT_CALIBRATION = {
  topLeft: { x: 0.19350282485875706, y: 0.21173469387755103 },
  bottomLeft: { x: 0.0, y: 0.6862244897959183 },
  topRight: { x: 0.8559322033898306, y: 0.25510204081632654 },
  bottomRight: { x: 1.0, y: 0.6785714285714286 },
};

/** Parses scouting-ai's calibration.txt ("x,y" per line: TL, BL, TR, BR). */
function parseCalibrationText(text) {
  const rows = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(',').map(Number));
  if (rows.length < 4 || rows.slice(0, 4).some((r) => r.length < 2 || r.some((v) => !Number.isFinite(v)))) {
    return null;
  }
  return {
    topLeft: { x: rows[0][0], y: rows[0][1] },
    bottomLeft: { x: rows[1][0], y: rows[1][1] },
    topRight: { x: rows[2][0], y: rows[2][1] },
    bottomRight: { x: rows[3][0], y: rows[3][1] },
  };
}

function serializeCalibration(c) {
  return [c.topLeft, c.bottomLeft, c.topRight, c.bottomRight].map((p) => `${p.x},${p.y}`).join('\n');
}

function validateCalibration(c) {
  const keys = ['topLeft', 'bottomLeft', 'topRight', 'bottomRight'];
  if (!c || keys.some((k) => !c[k] || !Number.isFinite(c[k].x) || !Number.isFinite(c[k].y))) {
    throw new Error('Field calibration needs four valid corners.');
  }
  return c;
}

// -------------------------------------------------------------- detection ---

// Fraction of the box height (from the top) used as the robot's floor position.
const FOOTPRINT = 0.85;
// Consecutive frames that must all show every robot before tracking starts.
const START_STABLE_FRAMES = 6;
// Length of the autonomous period (2026 REBUILT: 20 s).
const AUTO_SECONDS = 20;
// Distance (field widths) a robot must move before it counts as driving, and the
// typical delay between the buzzer and a robot covering that distance.
const MOVE_DIST = 0.03;
const MOVE_LAG = 0.5;
// Fill paths backwards when lock-on comes this many seconds after the requested start.
const BACKFILL_MIN_GAP = 0.5;
// Seconds of motion extrapolated when matching a robot to a detection.
const MAX_PREDICT_SEC = 0.4;

/**
 * Port of AIScout.detect(): groups the flat detections by frame, maps Robot
 * boxes into field coordinates and decides which frames are autonomous.
 *
 * A frame is "auto" when it contains an `Auto` class detection, or when it lies
 * before `teleopStartSec` (when > 0). Frames without any Robot/Auto detection
 * (e.g. only `Tele Op`) are skipped — indices refer to the kept frames.
 */
function extractFrames(detections, calibration, teleopStartSec = 0, opts = {}) {
  const { legacy = false } = opts;
  const cal = validateCalibration(calibration);
  const TL = new Point(cal.topLeft.x, cal.topLeft.y, 0);
  const BL = new Point(cal.bottomLeft.x, cal.bottomLeft.y, 0);
  const TR = new Point(cal.topRight.x, cal.topRight.y, 0);
  const BR = new Point(cal.bottomRight.x, cal.bottomRight.y, 0);

  const frames = [];
  const frameTimes = [];
  const autoFrames = new Set();
  let current = null;
  let currentFrameId = null;
  let currentIsAuto = false;
  let currentTime = 0;

  const flush = () => {
    if (!current) return;
    if (currentIsAuto) autoFrames.add(frames.length);
    // Strongest detections first so callers can drop weak extras (false positives).
    if (!legacy) current.sort((a, b) => b.conf - a.conf);
    frames.push(current);
    frameTimes.push(currentTime);
  };

  for (const det of detections) {
    const cls = det.class_name;
    if (cls !== 'Robot' && cls !== 'Auto') continue;

    if (current === null || det.frame_id !== currentFrameId) {
      flush();
      current = [];
      currentFrameId = det.frame_id;
      currentIsAuto = false;
      const time = det.frame_id / det.frame_fps;
      currentTime = time;
      if (teleopStartSec >= 0 && time < teleopStartSec) currentIsAuto = true;
    }

    if (cls === 'Auto') {
      currentIsAuto = true;
      continue;
    }

    const cx = ((det.x_min + det.x_max) / 2) / det.frame_width;
    // The field homography describes the floor, so anchor on the robot's
    // footprint (near the bottom of its box) rather than the middle of its body,
    // which floats above the floor and skews far robots toward the back wall.
    const yAnchor = legacy ? (det.y_min + det.y_max) / 2 : det.y_min + (det.y_max - det.y_min) * FOOTPRINT;
    const cy = yAnchor / det.frame_height;
    const time = det.frame_id / det.frame_fps;
    const probe = new Point(cx, cy, time);
    const x = estimateXcoord(probe, TL, TR, BL, BR, 10, 0, 1);
    const y = estimateYcoord(probe, TL, TR, BL, BR, 10, 0, 1);
    if (x !== null && y !== null) {
      const pt = new Point(x, y, time);
      pt.conf = Number.isFinite(det.confidence) ? det.confidence : 0;
      pt.w = (det.x_max - det.x_min) / det.frame_width;
      if (Array.isArray(det.feat)) pt.f = det.feat; // colour signature from appearance.py, when present
      current.push(pt);
    }
  }
  flush();

  return { frames, autoFrames, frameTimes };
}

// --------------------------------------------------------------- tracking ---

class FRCRobot {
  constructor(pos, team, redOnLeft) {
    this.pos = pos;
    this.team = team;
    this.redOnLeft = redOnLeft;
    this.history = [];
    this.vx = 0;
    this.vy = 0;
    // Mirrors the Java constructor: the first sample is always recorded as auto.
    this.updatePosition(pos, true);
  }

  updatePosition(pos, isAuto) {
    const distance = this.pos.distanceTo(pos);
    const timeDiff = pos.time - this.pos.time;
    const speed = distance / timeDiff; // NaN for the very first sample -> accepted
    if (speed > 1) return; // teleported too fast: treat as a mismatch
    if (timeDiff > 0 && Number.isFinite(speed)) {
      // Smoothed velocity, used by the non-legacy tracker to predict where the robot goes next.
      this.vx = 0.6 * this.vx + 0.4 * ((pos.x - this.pos.x) / timeDiff);
      this.vy = 0.6 * this.vy + 0.4 * ((pos.y - this.pos.y) / timeDiff);
    }
    this.pos = pos;
    // When red is on the left of the video the field is mirrored so that every
    // match shares one orientation in the visualisation.
    const x = this.redOnLeft ? 1 - pos.x : pos.x;
    const y = this.redOnLeft ? 1 - pos.y : pos.y;
    this.history.push({ isAuto: Boolean(isAuto), x, y, time: pos.time });
  }

  /** Where the robot most likely is at `time`, extrapolating its recent velocity. */
  predict(time) {
    const dt = Math.min(Math.max(time - this.pos.time, 0), MAX_PREDICT_SEC);
    return new Point(this.pos.x + this.vx * dt, this.pos.y + this.vy * dt, time);
  }
}

const NO_SHOW = 'no_show';

/**
 * @param {Point[][]} frames        from extractFrames
 * @param {Set<number>} autoFrames  from extractFrames
 * @param {string[]} teams          6 entries: 3 left (closest to camera first) then 3 right; 'no_show' allowed
 * @param {object} opts
 *   redOnLeft       bool (default true)
 *   manualStarts    { left: number[], right: number[] } y values (0..1) when no frame shows every robot
 *   onProgress      (fraction) => void
 *   legacy          bool: exact scouting-ai behaviour (first frame with exactly N boxes, nearest-last-position matching)
 *   frameTimes      seconds per frame (from extractFrames); needed for startTime
 *   startTime       seconds: don't begin tracking before this video time
 *   matchStart      seconds: when the match (auto) starts; detected from motion when absent
 *   teleopStart     seconds: when teleop starts; overrides matchStart + autoSeconds
 *   autoSeconds     length of the autonomous period (default AUTO_SECONDS)
 */
function trackRobots(frames, autoFrames, teams, opts = {}) {
  const { redOnLeft = true, manualStarts = null, onProgress = null, legacy = false, frameTimes = null, startTime = 0, autoSeconds = AUTO_SECONDS } = opts;
  if (!Array.isArray(teams) || teams.length !== 6) {
    throw new Error(`Exactly 6 team slots are required (3 left, 3 right); got ${teams ? teams.length : 0}.`);
  }
  const shows = teams.map((t) => t !== NO_SHOW);
  const leftShows = shows.slice(0, 3).filter(Boolean).length;
  const rightShows = shows.slice(3).filter(Boolean).length;
  const amountShows = leftShows + rightShows;
  if (amountShows === 0) throw new Error('At least one team must show up.');

  let firstFrameIndex = legacy ? 0 : findStartFrame(frames, frameTimes, amountShows, startTime);
  if (legacy) while (firstFrameIndex < frames.length && frames[firstFrameIndex].length !== amountShows) firstFrameIndex++;
  const autoStartFound = firstFrameIndex < frames.length;

  let starting;
  if (autoStartFound) {
    starting = frames[firstFrameIndex].slice(0, amountShows);
  } else {
    if (!manualStarts) {
      const err = new Error(
        `No frame with all ${amountShows} robots detected. Enter the starting positions manually or try another video.`
      );
      err.code = 'NO_START_FRAME';
      err.amountShows = amountShows;
      err.leftShows = leftShows;
      err.rightShows = rightShows;
      throw err;
    }
    const { left = [], right = [] } = manualStarts;
    if (left.length !== leftShows || right.length !== rightShows) {
      throw new Error('Number of starting coordinates does not match the number of robots on each side.');
    }
    const bad = [...left, ...right].find((y) => !Number.isFinite(y) || y < 0 || y > 1);
    if (bad !== undefined) throw new Error(`Invalid starting coordinate "${bad}": use values from 0.0 to 1.0.`);
    firstFrameIndex = 0;
    starting = [...left.map((y) => new Point(0.25, y, 0)), ...right.map((y) => new Point(0.75, y, 0))];
  }

  // Left-most robots belong to the left alliance; within a side, larger y
  // (closer to the camera) comes first — matching the team entry order.
  starting.sort((a, b) => a.x - b.x);
  const leftHalf = starting.slice(0, leftShows).sort((a, b) => b.y - a.y);
  const rightHalf = starting.slice(leftShows, leftShows + rightShows).sort((a, b) => b.y - a.y);

  const robots = [];
  let li = 0;
  for (let i = 0; i < 3; i++) if (shows[i]) robots.push(new FRCRobot(leftHalf[li++], teams[i], redOnLeft));
  let ri = 0;
  for (let i = 3; i < 6; i++) if (shows[i]) robots.push(new FRCRobot(rightHalf[ri++], teams[i], redOnLeft));

  const last = frames.length - 1;
  if (!legacy) {
    const trackerOpts = { ...(opts.tracker || {}), redOnLeft };
    const out = trackOffline(frames, robots.map((r) => r.pos), robots.map((r) => r.team), firstFrameIndex, autoFrames, { ...trackerOpts, onProgress });
    backfill(out, frames, frameTimes, firstFrameIndex, startTime, robots, trackerOpts);
    // Auto is a fixed window after the match starts. The detector's Auto/Tele Op
    // classes are too unreliable to use, so the window comes from (in order) the
    // user's teleop time, the user's match start, or when the robots start moving.
    const matchStart = opts.matchStart > 0 ? opts.matchStart : detectMatchStart(out);
    const autoEnd = opts.teleopStart > 0 ? opts.teleopStart : matchStart + autoSeconds;
    for (const r of out) {
      for (const h of r.history) h.isAuto = h.time < autoEnd;
    }
    return {
      matchStart: Math.round(matchStart * 10) / 10,
      autoEnd: Math.round(autoEnd * 10) / 10,
      firstFrameIndex,
      autoStartFound,
      totalFrames: frames.length,
      startTime: firstPathTime(out, frameTimes, firstFrameIndex),
      startPercent: frames.length ? Math.round((firstFrameIndex * 1000) / frames.length) / 10 : 0,
      robots: out,
    };
  }
  for (let i = firstFrameIndex + 1; i < frames.length; i++) {
    if (onProgress && (i % 250 === 0 || i === last)) onProgress(last > 0 ? i / last : 1);
    const dets = frames[i];
    if (dets.length === 0) continue;

    const cost = robots.map((r) => dets.map((d) => (legacy ? r.pos : r.predict(d.time)).distanceTo(d)));
    const assignment = hungarian(cost);
    const isAuto = autoFrames.has(i);
    for (let j = 0; j < assignment.length; j++) {
      if (assignment[j] !== -1) robots[j].updatePosition(dets[assignment[j]], isAuto);
    }
  }

  return {
    firstFrameIndex,
    autoStartFound,
    totalFrames: frames.length,
    startTime: frameTimes && frameTimes[firstFrameIndex] !== undefined ? Math.round(frameTimes[firstFrameIndex] * 10) / 10 : null,
    startPercent: frames.length ? Math.round((firstFrameIndex * 1000) / frames.length) / 10 : 0,
    robots: robots.map((r) => ({ team: r.team, history: r.history })),
  };
}

/**
 * First frame (at or after `startTime`) that shows every robot and keeps doing
 * so for START_STABLE_FRAMES frames. A single frame with N boxes is often a
 * fluke (a missed robot plus a false positive), which seeds the whole match with
 * a wrong start; sustained visibility is a far better sign that the boxes are the
 * real robots. Falls back to the first frame with enough boxes, then -1 -> frames.length.
 */
function findStartFrame(frames, frameTimes, amountShows, startTime = 0) {
  let from = 0;
  if (frameTimes && startTime > 0) while (from < frames.length && frameTimes[from] < startTime) from++;
  let firstEnough = -1;
  let run = 0;
  for (let i = from; i < frames.length; i++) {
    if (frames[i].length >= amountShows) {
      if (firstEnough === -1) firstEnough = i;
      run++;
      if (run >= START_STABLE_FRAMES) return i - START_STABLE_FRAMES + 1;
    } else {
      run = 0;
    }
  }
  return firstEnough === -1 ? frames.length : firstEnough;
}

/**
 * Tracking can only lock on once every robot is in view together, which in some
 * videos happens well after the match has started. When the user told us where
 * to start (`startTime`), run the tracker backwards in time from that lock-on
 * frame to `startTime` and prepend the result, so the paths (and the replay)
 * cover the whole match instead of beginning late.
 */
function backfill(out, frames, frameTimes, startIndex, startTime, robots, trackerOpts) {
  if (!frameTimes || !(startTime > 0) || frameTimes[startIndex] - startTime < BACKFILL_MIN_GAP) return;
  let from = startIndex;
  while (from > 0 && frameTimes[from - 1] >= startTime) from--;
  // Same frames in reverse with time negated, so the filter still sees time moving forward.
  const flip = (p) => Object.assign(new Point(p.x, p.y, -p.time), { conf: p.conf, w: p.w, f: p.f });
  const reversed = [];
  for (let i = startIndex; i >= from; i--) reversed.push(frames[i].map(flip));
  const back = trackOffline(reversed, robots.map((r) => flip(r.pos)), robots.map((r) => r.team), 0, new Set(), trackerOpts);
  back.forEach((b, k) => {
    const earlier = b.history
      .map((h) => ({ ...h, time: Math.round(-h.time * 1e4) / 1e4 }))
      .reverse()
      .filter((h) => h.time < (out[k].history.length ? out[k].history[0].time : Infinity));
    out[k].history = earlier.concat(out[k].history);
  });
}

function firstPathTime(out, frameTimes, startIndex) {
  const t = Math.min(...out.filter((r) => r.history.length).map((r) => r.history[0].time));
  if (Number.isFinite(t)) return Math.round(t * 10) / 10;
  return frameTimes && frameTimes[startIndex] !== undefined ? Math.round(frameTimes[startIndex] * 10) / 10 : null;
}

/**
 * The moment the robots start driving: the first time two robots have each
 * moved MOVE_DIST from where tracking found them, less the reaction lag. Robots
 * stand still before the buzzer and nearly all move in the first second of auto.
 */
function detectMatchStart(robots) {
  const t0 = Math.min(...robots.filter((r) => r.history.length).map((r) => r.history[0].time));
  if (!Number.isFinite(t0)) return 0;
  const moved = robots
    .filter((r) => r.history.length)
    .map((r) => {
      const h0 = r.history[0];
      const hit = r.history.find((h) => Math.hypot(h.x - h0.x, (h.y - h0.y) / 2) > MOVE_DIST);
      return hit ? hit.time : Infinity;
    })
    .sort((a, b) => a - b);
  const second = moved.length > 1 ? moved[1] : moved[0];
  if (!Number.isFinite(second)) return t0;
  return Math.max(t0, second - MOVE_LAG);
}

/** Summary of the frame the tracker would start from (for the confirmation step). */
function describeStart(frames, teams, opts = {}) {
  const amountShows = teams.filter((t) => t !== NO_SHOW).length;
  const idx = opts.legacy
    ? (() => { let i = 0; while (i < frames.length && frames[i].length !== amountShows) i++; return i; })()
    : findStartFrame(frames, opts.frameTimes, amountShows, opts.startTime);
  if (idx >= frames.length) return { found: false, amountShows, totalFrames: frames.length };
  return {
    found: true,
    amountShows,
    index: idx,
    totalFrames: frames.length,
    percent: Math.round((idx * 1000) / frames.length) / 10,
  };
}

/** The exact text AIScout appends to data/<team>.csv for one match. */
function historyToCsv(history) {
  const lines = ['---------------------------------------'];
  for (const h of history) lines.push(`${h.isAuto},${h.x},${h.y},${h.time}`);
  return lines.join('\n') + '\n';
}

module.exports = {
  Point, Line, hungarian, estimateXcoord, estimateYcoord,
  DEFAULT_CALIBRATION, parseCalibrationText, serializeCalibration, validateCalibration,
  extractFrames, trackRobots, describeStart, historyToCsv, NO_SHOW,
};
