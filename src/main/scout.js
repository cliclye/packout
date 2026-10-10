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

// ------------------------------------------------------------- hungarian ----

/** Kevin Stern's O(n^3) Hungarian algorithm. Returns, per row, its column or -1. */
function hungarian(costMatrix) {
  const rows = costMatrix.length;
  const cols = costMatrix[0].length;
  const dim = Math.max(rows, cols);

  const cost = [];
  for (let w = 0; w < dim; w++) {
    const row = new Float64Array(dim);
    if (w < rows) {
      for (let j = 0; j < cols; j++) {
        const v = costMatrix[w][j];
        if (!Number.isFinite(v)) throw new Error('Non-finite cost in assignment matrix');
        row[j] = v;
      }
    }
    cost.push(row);
  }

  const labelByWorker = new Float64Array(dim);
  const labelByJob = new Float64Array(dim);
  const minSlackWorkerByJob = new Int32Array(dim);
  const minSlackValueByJob = new Float64Array(dim);
  const committedWorkers = new Array(dim).fill(false);
  const parentWorkerByCommittedJob = new Int32Array(dim);
  const matchJobByWorker = new Int32Array(dim).fill(-1);
  const matchWorkerByJob = new Int32Array(dim).fill(-1);

  const match = (w, j) => {
    matchJobByWorker[w] = j;
    matchWorkerByJob[j] = w;
  };

  // reduce
  for (let w = 0; w < dim; w++) {
    let min = Infinity;
    for (let j = 0; j < dim; j++) if (cost[w][j] < min) min = cost[w][j];
    for (let j = 0; j < dim; j++) cost[w][j] -= min;
  }
  const colMin = new Float64Array(dim).fill(Infinity);
  for (let w = 0; w < dim; w++) {
    for (let j = 0; j < dim; j++) if (cost[w][j] < colMin[j]) colMin[j] = cost[w][j];
  }
  for (let w = 0; w < dim; w++) {
    for (let j = 0; j < dim; j++) cost[w][j] -= colMin[j];
  }

  // initial feasible solution
  for (let j = 0; j < dim; j++) labelByJob[j] = Infinity;
  for (let w = 0; w < dim; w++) {
    for (let j = 0; j < dim; j++) if (cost[w][j] < labelByJob[j]) labelByJob[j] = cost[w][j];
  }

  // greedy match
  for (let w = 0; w < dim; w++) {
    for (let j = 0; j < dim; j++) {
      if (matchJobByWorker[w] === -1 && matchWorkerByJob[j] === -1 &&
          cost[w][j] - labelByWorker[w] - labelByJob[j] === 0) {
        match(w, j);
      }
    }
  }

  const fetchUnmatchedWorker = () => {
    let w = 0;
    for (; w < dim; w++) if (matchJobByWorker[w] === -1) break;
    return w;
  };

  const initializePhase = (w) => {
    committedWorkers.fill(false);
    parentWorkerByCommittedJob.fill(-1);
    committedWorkers[w] = true;
    for (let j = 0; j < dim; j++) {
      minSlackValueByJob[j] = cost[w][j] - labelByWorker[w] - labelByJob[j];
      minSlackWorkerByJob[j] = w;
    }
  };

  const updateLabeling = (slack) => {
    for (let w = 0; w < dim; w++) if (committedWorkers[w]) labelByWorker[w] += slack;
    for (let j = 0; j < dim; j++) {
      if (parentWorkerByCommittedJob[j] !== -1) labelByJob[j] -= slack;
      else minSlackValueByJob[j] -= slack;
    }
  };

  const executePhase = () => {
    for (;;) {
      let minSlackWorker = -1;
      let minSlackJob = -1;
      let minSlackValue = Infinity;
      for (let j = 0; j < dim; j++) {
        if (parentWorkerByCommittedJob[j] === -1 && minSlackValueByJob[j] < minSlackValue) {
          minSlackValue = minSlackValueByJob[j];
          minSlackWorker = minSlackWorkerByJob[j];
          minSlackJob = j;
        }
      }
      if (minSlackValue > 0) updateLabeling(minSlackValue);
      parentWorkerByCommittedJob[minSlackJob] = minSlackWorker;
      if (matchWorkerByJob[minSlackJob] === -1) {
        let committedJob = minSlackJob;
        let parentWorker = parentWorkerByCommittedJob[committedJob];
        for (;;) {
          const temp = matchJobByWorker[parentWorker];
          match(parentWorker, committedJob);
          committedJob = temp;
          if (committedJob === -1) break;
          parentWorker = parentWorkerByCommittedJob[committedJob];
        }
        return;
      }
      const worker = matchWorkerByJob[minSlackJob];
      committedWorkers[worker] = true;
      for (let j = 0; j < dim; j++) {
        if (parentWorkerByCommittedJob[j] === -1) {
          const slack = cost[worker][j] - labelByWorker[worker] - labelByJob[j];
          if (minSlackValueByJob[j] > slack) {
            minSlackValueByJob[j] = slack;
            minSlackWorkerByJob[j] = worker;
          }
        }
      }
    }
  };

  let w = fetchUnmatchedWorker();
  while (w < dim) {
    initializePhase(w);
    executePhase();
    w = fetchUnmatchedWorker();
  }

  const result = Array.from(matchJobByWorker.subarray(0, rows));
  for (let i = 0; i < result.length; i++) if (result[i] >= cols) result[i] = -1;
  return result;
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

/**
 * Port of AIScout.detect(): groups the flat detections by frame, maps Robot
 * boxes into field coordinates and decides which frames are autonomous.
 *
 * A frame is "auto" when it contains an `Auto` class detection, or when it lies
 * before `teleopStartSec` (when > 0). Frames without any Robot/Auto detection
 * (e.g. only `Tele Op`) are skipped — indices refer to the kept frames.
 */
function extractFrames(detections, calibration, teleopStartSec = 0) {
  const cal = validateCalibration(calibration);
  const TL = new Point(cal.topLeft.x, cal.topLeft.y, 0);
  const BL = new Point(cal.bottomLeft.x, cal.bottomLeft.y, 0);
  const TR = new Point(cal.topRight.x, cal.topRight.y, 0);
  const BR = new Point(cal.bottomRight.x, cal.bottomRight.y, 0);

  const frames = [];
  const autoFrames = new Set();
  let current = null;
  let currentFrameId = null;
  let currentIsAuto = false;

  const flush = () => {
    if (!current) return;
    if (currentIsAuto) autoFrames.add(frames.length);
    frames.push(current);
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
      if (teleopStartSec >= 0 && time < teleopStartSec) currentIsAuto = true;
    }

    if (cls === 'Auto') {
      currentIsAuto = true;
      continue;
    }

    const cx = ((det.x_min + det.x_max) / 2) / det.frame_width;
    const cy = ((det.y_min + det.y_max) / 2) / det.frame_height;
    const time = det.frame_id / det.frame_fps;
    const probe = new Point(cx, cy, time);
    const x = estimateXcoord(probe, TL, TR, BL, BR, 10, 0, 1);
    const y = estimateYcoord(probe, TL, TR, BL, BR, 10, 0, 1);
    if (x !== null && y !== null) current.push(new Point(x, y, time));
  }
  flush();

  return { frames, autoFrames };
}

// --------------------------------------------------------------- tracking ---

class FRCRobot {
  constructor(pos, team, redOnLeft) {
    this.pos = pos;
    this.team = team;
    this.redOnLeft = redOnLeft;
    this.history = [];
    // Mirrors the Java constructor: the first sample is always recorded as auto.
    this.updatePosition(pos, true);
  }

  updatePosition(pos, isAuto) {
    const distance = this.pos.distanceTo(pos);
    const timeDiff = pos.time - this.pos.time;
    const speed = distance / timeDiff; // NaN for the very first sample -> accepted
    if (speed > 1) return; // teleported too fast: treat as a mismatch
    this.pos = pos;
    // When red is on the left of the video the field is mirrored so that every
    // match shares one orientation in the visualisation.
    const x = this.redOnLeft ? 1 - pos.x : pos.x;
    const y = this.redOnLeft ? 1 - pos.y : pos.y;
    this.history.push({ isAuto: Boolean(isAuto), x, y, time: pos.time });
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
 */
function trackRobots(frames, autoFrames, teams, opts = {}) {
  const { redOnLeft = true, manualStarts = null, onProgress = null } = opts;
  if (!Array.isArray(teams) || teams.length !== 6) {
    throw new Error(`Exactly 6 team slots are required (3 left, 3 right); got ${teams ? teams.length : 0}.`);
  }
  const shows = teams.map((t) => t !== NO_SHOW);
  const leftShows = shows.slice(0, 3).filter(Boolean).length;
  const rightShows = shows.slice(3).filter(Boolean).length;
  const amountShows = leftShows + rightShows;
  if (amountShows === 0) throw new Error('At least one team must show up.');

  let firstFrameIndex = 0;
  while (firstFrameIndex < frames.length && frames[firstFrameIndex].length !== amountShows) firstFrameIndex++;
  const autoStartFound = firstFrameIndex < frames.length;

  let starting;
  if (autoStartFound) {
    starting = frames[firstFrameIndex].slice();
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
  for (let i = firstFrameIndex + 1; i < frames.length; i++) {
    if (onProgress && (i % 250 === 0 || i === last)) onProgress(last > 0 ? i / last : 1);
    const dets = frames[i];
    if (dets.length === 0) continue;

    const cost = robots.map((r) => dets.map((d) => r.pos.distanceTo(d)));
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
    startPercent: frames.length ? Math.round((firstFrameIndex * 1000) / frames.length) / 10 : 0,
    robots: robots.map((r) => ({ team: r.team, history: r.history })),
  };
}

/** Summary of the frame the tracker would start from (for the confirmation step). */
function describeStart(frames, teams) {
  const amountShows = teams.filter((t) => t !== NO_SHOW).length;
  let idx = 0;
  while (idx < frames.length && frames[idx].length !== amountShows) idx++;
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
