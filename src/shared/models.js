/**
 * Plain-data models. Records are JSON-safe objects (no classes) so they survive
 * being saved to disk and loaded again — derived values live in functions below.
 */

const toInt = (v, d = 0) => {
  const n = typeof v === 'number' ? Math.trunc(v) : parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : d;
};
const toNum = (v, d = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').trim());
  return Number.isFinite(n) ? n : d;
};
const toStr = (v) => (v === undefined || v === null ? '' : String(v)).trim();
let uid = 0;
const makeId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(uid++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function normalizeMatch(d = {}) {
  return {
    id: d.id || makeId('match'),
    sourcePath: d.sourcePath || '',
    teamNumber: toStr(d.teamNumber),
    matchNumber: toStr(d.matchNumber),
    autoHub: toInt(d.autoHub),
    autoHubMissed: toInt(d.autoHubMissed),
    autoClimb: toInt(d.autoClimb),
    autoClimbLocation: Math.max(1, toInt(d.autoClimbLocation, 1)),
    teleOpHub: toInt(d.teleOpHub),
    teleOpHubMissed: toInt(d.teleOpHubMissed),
    teleOpPassed: toInt(d.teleOpPassed),
    teleOpClimb: toInt(d.teleOpClimb),
    teleOpClimbLocation: Math.max(1, toInt(d.teleOpClimbLocation, 1)),
    defEffectiveness: toInt(d.defEffectiveness),
    defDuration: toInt(d.defDuration),
    brokeDuration: toInt(d.brokeDuration),
    underDefDuration: toInt(d.underDefDuration),
    notes: d.notes ? String(d.notes) : '',
    scouterName: toStr(d.scouterName),
    importedAt: d.importedAt || new Date().toISOString(),
  };
}

function normalizePit(d = {}) {
  return {
    id: d.id || makeId('pit'),
    sourcePath: d.sourcePath || '',
    teamNumber: toStr(d.teamNumber),
    driveTrain: toInt(d.driveTrain),
    intake: toInt(d.intake),
    launcher: toInt(d.launcher),
    width: toInt(d.width),
    terrain: toInt(d.terrain),
    notes: d.notes ? String(d.notes) : '',
    imagePath: d.imagePath || null,
    importedAt: d.importedAt || new Date().toISOString(),
  };
}

function normalizeScheduled(d = {}) {
  const matchNumber = toInt(d.matchNumber);
  return {
    matchNumber,
    name: d.name || `Match ${matchNumber}`,
    redTeams: (d.redTeams || []).map(String),
    blueTeams: (d.blueTeams || []).map(String),
    timeLabel: d.timeLabel || '',
  };
}

/** One robot's tracked path for one match. */
function normalizePathRun(d = {}) {
  return {
    id: d.id || makeId('path'),
    teamNumber: toStr(d.teamNumber),
    matchNumber: toStr(d.matchNumber),
    source: d.source || 'csv', // 'ai' | 'csv' | 'sample'
    sourcePath: d.sourcePath || '',
    createdAt: d.createdAt || new Date().toISOString(),
    samples: (d.samples || []).map((s) => ({
      isAuto: Boolean(s.isAuto),
      x: toNum(s.x),
      y: toNum(s.y),
      time: toNum(s.time),
    })),
  };
}

function normalizeVideo(d = {}) {
  return {
    id: d.id || makeId('video'),
    url: d.url || '',
    inferredMatchNumber: d.inferredMatchNumber ? toStr(d.inferredMatchNumber) : null,
  };
}

// ---- derived values --------------------------------------------------------

const totalMade = (m) => m.autoHub + m.teleOpHub;
const totalMissed = (m) => m.autoHubMissed + m.teleOpHubMissed;
const totalAttempts = (m) => totalMade(m) + totalMissed(m);
const shootingEfficiency = (m) => (totalAttempts(m) === 0 ? 0 : totalMade(m) / totalAttempts(m));

const CLIMB_LABELS = { 1: 'Fail', 2: 'L1', 3: 'L2', 4: 'L3' };
const CLIMB_POINTS = { 2: 4, 3: 8, 4: 12 };
const climbLabel = (v) => CLIMB_LABELS[v] || 'None';
const climbPoints = (v) => CLIMB_POINTS[v] || 0;

function estimatedScore(m) {
  const autoClimbBonus = m.autoClimb > 1 ? 2 : 0;
  return m.autoHub * 3 + m.teleOpHub * 2 + m.teleOpPassed * 0.5 + climbPoints(m.teleOpClimb) + autoClimbBonus;
}

const label = (list, i) => (i >= 0 && i < list.length ? list[i] : 'Unknown');
const DRIVETRAINS = ['West Coast', 'Mecanum', 'Swerve', 'Other'];
const INTAKES = ['No Intake', 'Source Only', 'Split Bumper', 'Over Bumper', 'Source + Split', 'Source + Over'];
const LAUNCHERS = ['No Launcher', 'Fixed Hood', 'Adjustable Hood', 'Adjustable Rotation', 'Fully Adjustable'];
const TERRAINS = ['No Traversal', 'Bump', 'Trench', 'Bump + Trench'];
const pitLabels = (p) => ({
  driveTrain: label(DRIVETRAINS, p.driveTrain),
  intake: label(INTAKES, p.intake),
  launcher: label(LAUNCHERS, p.launcher),
  terrain: label(TERRAINS, p.terrain),
});

/** Numeric part of a team/match string ("Q12" -> 12). Non-numeric sorts last. */
const naturalNumber = (s) => {
  const digits = String(s ?? '').replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : Number.MAX_SAFE_INTEGER;
};
const byNatural = (a, b) => naturalNumber(a) - naturalNumber(b);

module.exports = {
  toInt, toNum, toStr, makeId,
  normalizeMatch, normalizePit, normalizeScheduled, normalizePathRun, normalizeVideo,
  totalMade, totalMissed, totalAttempts, shootingEfficiency, estimatedScore,
  climbLabel, climbPoints, pitLabels,
  DRIVETRAINS, INTAKES, LAUNCHERS, TERRAINS,
  naturalNumber, byNatural,
};
