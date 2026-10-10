/**
 * Team summaries + pick scoring. Ported from packoutMac/Analytics.swift so the
 * rankings match the Mac app exactly.
 */
const { estimatedScore, shootingEfficiency, byNatural, naturalNumber } = require('./models');

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stddev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) * (v - m), 0) / (xs.length - 1));
};
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const percentile = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = clamp(Math.round((s.length - 1) * p), 0, s.length - 1);
  return s[idx];
};

function noteFlags(notes, avgBroke, matchCount) {
  const n = notes.toLowerCase();
  const flags = [];
  if (n.includes('broke') || n.includes('disabled') || n.includes('dead') || avgBroke >= 20) flags.push('Breakdowns');
  if (n.includes('defense') || n.includes('blocked') || n.includes('pinned')) flags.push('Defense');
  if (n.includes('slow') || n.includes('stuck') || n.includes('jam')) flags.push('Mobility');
  if (n.includes('no show') || n.includes('noshow') || n.includes('absent')) flags.push('No-show');
  if (matchCount > 0 && matchCount < 3) flags.push('Low sample');
  return flags.sort();
}

function riskLabel(avgBroke, reliability, flags) {
  if (avgBroke >= 25 || flags.includes('Breakdowns')) return 'High';
  if (reliability < 45 || flags.length >= 2) return 'Medium';
  return 'Low';
}

function roleFor(rank, count, s) {
  if (rank <= 8) return 'Captain Core';
  if (s.defenseIndex >= 70 && s.reliability >= 55) return 'Defense Anchor';
  if (s.shootingEfficiency >= 0.7 && s.averageScore >= 8) return 'Efficient Scorer';
  if (s.climbRate >= 0.7) return 'Endgame Value';
  if (rank <= Math.max(16, count / 3)) return 'First Round';
  return 'Depth';
}

/** @returns TeamSummary[] sorted by pickScore (rank 1 first) */
function summarize(matches, pits, paths) {
  const grouped = new Map();
  for (const m of matches) {
    if (!grouped.has(m.teamNumber)) grouped.set(m.teamNumber, []);
    grouped.get(m.teamNumber).push(m);
  }
  const pathTeams = new Map();
  for (const p of paths) {
    if (!pathTeams.has(p.teamNumber)) pathTeams.set(p.teamNumber, []);
    pathTeams.get(p.teamNumber).push(p);
  }
  const allTeams = new Set([...grouped.keys(), ...pits.map((p) => p.teamNumber), ...pathTeams.keys()]);
  allTeams.delete('');

  const raw = [];
  for (const team of allTeams) {
    const tm = (grouped.get(team) || []).slice().sort((a, b) => byNatural(a.matchNumber, b.matchNumber));
    const matchCount = tm.length;
    const scores = tm.map(estimatedScore);
    const avgScore = mean(scores);
    const avgEfficiency = mean(tm.map(shootingEfficiency));
    const sd = stddev(scores);
    const avgBroke = mean(tm.map((m) => m.brokeDuration));
    const avgDefDur = mean(tm.map((m) => m.defDuration));
    const avgDefRating = mean(tm.map((m) => m.defEffectiveness));
    const climbRate = matchCount ? tm.filter((m) => m.teleOpClimb > 1).length / matchCount : 0;
    const pathCoverage = (pathTeams.get(team) || []).reduce((n, p) => n + p.samples.length, 0);

    const consistency = avgScore <= 0 ? 0 : clamp(100 - (sd / Math.max(avgScore, 1)) * 100, 0, 100);
    const availability = clamp(100 - (avgBroke / 135) * 100, 0, 100);
    const coverage = clamp((matchCount / 6) * 100, 0, 100);
    const reliability = 0.52 * consistency + 0.28 * availability + 0.2 * coverage;
    const defenseIndex = clamp((avgDefRating / 5) * 62 + (avgDefDur / 135) * 38, 0, 100);
    const flags = noteFlags(tm.map((m) => m.notes).join(' '), avgBroke, matchCount);

    raw.push({
      rank: 0,
      teamNumber: team,
      matchCount,
      pickScore: 0,
      averageScore: avgScore,
      shootingEfficiency: avgEfficiency,
      reliability,
      defenseIndex,
      averageBrokeSeconds: avgBroke,
      climbRate,
      pathCoverage,
      consistency,
      role: 'Depth',
      riskLabel: riskLabel(avgBroke, reliability, flags),
      flags,
    });
  }

  const maxScore = Math.max(...raw.map((s) => s.averageScore), 1);
  for (const s of raw) {
    s.pickScore =
      0.43 * ((s.averageScore / maxScore) * 100) +
      0.24 * s.reliability +
      0.18 * (s.shootingEfficiency * 100) +
      0.08 * s.defenseIndex +
      0.07 * (s.climbRate * 100);
  }
  raw.sort((a, b) =>
    a.pickScore === b.pickScore ? naturalNumber(a.teamNumber) - naturalNumber(b.teamNumber) : b.pickScore - a.pickScore
  );
  raw.forEach((s, i) => {
    s.rank = i + 1;
    s.role = roleFor(s.rank, raw.length, s);
  });
  return raw;
}

// ---- picklist strategies (Pick 1 / Pick 2 blending) --------------------------

const STRATEGIES = [
  { id: 'balanced', title: 'Balanced', hint: 'Overall pick score' },
  { id: 'scoringBot', title: 'Scoring Bot', hint: 'Output + efficiency' },
  { id: 'defenseBot', title: 'Defense Bot', hint: 'Defense + uptime' },
  { id: 'reliableBot', title: 'Reliable Bot', hint: 'Consistency + low downtime' },
  { id: 'endgameBot', title: 'Endgame Bot', hint: 'Climb rate' },
];

function strategyScore(s, strategy) {
  switch (strategy) {
    case 'scoringBot':
      return s.averageScore * 1.9 + s.shootingEfficiency * 30 + s.climbRate * 8;
    case 'defenseBot':
      return s.defenseIndex * 3.2 + s.reliability * 6 + (s.role.toLowerCase().includes('def') ? 6 : 0) - s.averageBrokeSeconds * 0.2;
    case 'reliableBot':
      return s.reliability * 10 + s.shootingEfficiency * 14 - s.averageBrokeSeconds * 0.35;
    case 'endgameBot':
      return s.climbRate * 40 + s.reliability * 5 + s.averageScore;
    case 'balanced':
    default:
      return s.pickScore;
  }
}

const blendedScore = (s, pick1, pick2) => strategyScore(s, pick1) * 0.58 + strategyScore(s, pick2) * 0.42;

module.exports = {
  summarize, stddev, mean, median, percentile, clamp, STRATEGIES, strategyScore, blendedScore,
};
