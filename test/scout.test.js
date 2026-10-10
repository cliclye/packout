/**
 * Verifies the JS tracking port against output produced by the original Java
 * scouting-ai (AIScout) for the same detections + calibration.
 *
 *   node test/scout.test.js <scouting-ai-copy-dir> [teams...]
 *
 * <dir> must contain temp/output.json, calibration.txt and the data/*.csv that
 * the Java run wrote (teams default to 111 222 333 444 555 666).
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const scout = require('../src/main/scout');

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node test/scout.test.js <dir> [6 teams]');
  process.exit(2);
}
const teams = process.argv.length >= 9 ? process.argv.slice(3, 9) : ['111', '222', '333', '444', '555', '666'];

const detections = JSON.parse(fs.readFileSync(path.join(dir, 'temp/output.json'), 'utf8'));
const calibration = scout.parseCalibrationText(fs.readFileSync(path.join(dir, 'calibration.txt'), 'utf8'));
assert(calibration, 'calibration.txt should parse');

const t0 = Date.now();
const { frames, autoFrames } = scout.extractFrames(detections, calibration, Number(process.env.TELEOP || 0));
const result = scout.trackRobots(frames, autoFrames, teams, { redOnLeft: true });
console.log(`frames=${frames.length} start=${result.firstFrameIndex} (${result.startPercent}%) took ${Date.now() - t0}ms`);

let failed = 0;
for (const robot of result.robots) {
  const expected = fs.readFileSync(path.join(dir, 'data', `${robot.team}.csv`), 'utf8');
  const actual = scout.historyToCsv(robot.history);
  const norm = (t) => t.trim().split('\n').map((l) => l.split(',').map((v) => (isNaN(Number(v)) ? v : Number(v))).join(','));
  if (norm(expected).join('\n') === norm(actual).join('\n')) {
    console.log(`  ✓ ${robot.team}: ${robot.history.length} rows identical to Java output`);
  } else {
    failed++;
    const e = norm(expected);
    const a = norm(actual);
    let i = 0;
    while (i < e.length && e[i] === a[i]) i++;
    console.log(`  ✗ ${robot.team}: first difference at line ${i + 1}\n     java: ${e[i]}\n     js:   ${a[i]}`);
  }
}
process.exit(failed ? 1 : 0);
