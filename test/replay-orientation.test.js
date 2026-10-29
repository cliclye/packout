/**
 * Checks that the path replay moves the same way as the match video.
 *
 *   node test/replay-orientation.test.js [scouting-ai dir]
 *
 * Uses real detections (scouting-ai/temp/output.json + calibration.txt, a
 * red-on-left match). For every tracked robot it measures, over 1 s windows,
 * how the robot's detector box moved in the video (independent of the tracker)
 * and how its dot moved on the replay field, and requires the directions to
 * agree. It also checks the video overlay lands on the detector's boxes.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const scout = require('../src/main/scout');
const { squareToQuad, fieldToImage, displayPoint } = require('../src/shared/fieldProjection');

const dir = process.argv[2] || path.join(__dirname, '../../scouting-ai');
const detections = JSON.parse(fs.readFileSync(path.join(dir, 'temp/output.json'), 'utf8'));
const calibration = scout.parseCalibrationText(fs.readFileSync(path.join(dir, 'calibration.txt'), 'utf8'));
const REDLEFT = true; // this match has red on the left of the video

const { frames, autoFrames, frameTimes } = scout.extractFrames(detections, calibration, 0);
const result = scout.trackRobots(frames, autoFrames, ['1', '2', '3', '4', '5', '6'], { frameTimes, redOnLeft: REDLEFT });
const H = squareToQuad(calibration);

// raw detector boxes per time, as footprint pixels (same anchor the tracker uses)
const byTime = new Map();
for (const d of detections) {
  if (d.class_name !== 'Robot') continue;
  const t = Math.round((d.frame_id / d.frame_fps) * 100) / 100;
  if (!byTime.has(t)) byTime.set(t, []);
  byTime.get(t).push({ x: (d.x_min + d.x_max) / 2 / d.frame_width, y: (d.y_min + 0.85 * (d.y_max - d.y_min)) / d.frame_height, w: d.frame_width, h: d.frame_height });
}
const nearestBox = (t, p) => {
  const boxes = byTime.get(Math.round(t * 100) / 100);
  if (!boxes) return null;
  let best = null;
  let bd = Infinity;
  for (const b of boxes) {
    const d = Math.hypot((b.x - p.x) * b.w, (b.y - p.y) * b.h);
    if (d < bd) { bd = d; best = b; }
  }
  return best && { box: best, px: bd };
};
// overlay projection: undo the stored rotation, then field -> video
const toVideo = (s) => fieldToImage(H, REDLEFT ? 1 - s.x : s.x, REDLEFT ? 1 - s.y : s.y);

const overlayErr = [];
const agree = { flipX: 0, flipY: 0, rawX: 0, rawY: 0, nx: 0, ny: 0 };
for (const r of result.robots) {
  const h = r.history.filter((s) => !s.est);
  for (const s of h) {
    const hit = nearestBox(s.time, toVideo(s));
    if (hit) overlayErr.push(hit.px);
  }
  for (let i = 0; i + 30 < h.length; i += 15) {
    const a = h[i];
    const b = h[i + 30];
    if (Math.abs(b.time - a.time - 1) > 0.1) continue;
    const ba = nearestBox(a.time, toVideo(a));
    const bb = nearestBox(b.time, toVideo(b));
    if (!ba || !bb || ba.px > 25 || bb.px > 25) continue; // only where the tracker is on a real box
    const vdx = (bb.box.x - ba.box.x) * ba.box.w;
    const vdy = (bb.box.y - ba.box.y) * ba.box.h;
    const shown = (s) => displayPoint(s, REDLEFT); // what the replay draws
    const stored = (s) => displayPoint(s, false); // what it drew before the fix
    if (Math.abs(vdx) > 40) {
      agree.nx++;
      if (Math.sign(shown(b).x - shown(a).x) === Math.sign(vdx)) agree.flipX++;
      if (Math.sign(stored(b).x - stored(a).x) === Math.sign(vdx)) agree.rawX++;
    }
    if (Math.abs(vdy) > 25) {
      agree.ny++;
      if (Math.sign(shown(b).y - shown(a).y) === Math.sign(vdy)) agree.flipY++;
      if (Math.sign(stored(b).y - stored(a).y) === Math.sign(vdy)) agree.rawY++;
    }
  }
}
overlayErr.sort((a, b) => a - b);
const pct = (a, n) => `${((100 * a) / Math.max(1, n)).toFixed(1)}%`;
console.log(`overlay vs detector box: median ${overlayErr[overlayErr.length >> 1].toFixed(1)}px, 90% within ${overlayErr[Math.floor(overlayErr.length * 0.9)].toFixed(1)}px (${overlayErr.length} samples)`);
console.log(`left/right moves agreeing with video: replay ${pct(agree.flipX, agree.nx)}  (old unflipped view ${pct(agree.rawX, agree.nx)}) over ${agree.nx} moves`);
console.log(`near/far   moves agreeing with video: replay ${pct(agree.flipY, agree.ny)}  (old unflipped view ${pct(agree.rawY, agree.ny)}) over ${agree.ny} moves`);

assert(overlayErr[overlayErr.length >> 1] < 10, 'overlay should sit on the detector boxes');
assert(agree.nx > 50 && agree.flipX / agree.nx > 0.95, 'replay left/right must follow the video');
assert(agree.ny > 50 && agree.flipY / agree.ny > 0.95, 'replay near/far must follow the video');
console.log('ok');
