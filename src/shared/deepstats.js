/**
 * Advanced per-team statistics derived ONLY from data the scouting phones already
 * record (match JSON fields) plus AI robot paths. Nothing here needs new inputs.
 */
const { climbPoints, byNatural, shootingEfficiency } = require('./models');

const MATCH_SECONDS = 135;
// Playing field in metres; paths are stored as 0..1 of this rectangle.
const FIELD_M = { x: 16.46, y: 8.23 };

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) * (v - m), 0) / (xs.length - 1));
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Points a match record contributes, split by phase (mirrors estimatedScore). */
function pointsBreakdown(m) {
  const auto = m.autoHub * 3 + (m.autoClimb > 1 ? 2 : 0);
  const tele = m.teleOpHub * 2;
  const pass = m.teleOpPassed * 0.5;
  const climb = climbPoints(m.teleOpClimb);
  return { auto, tele, pass, climb, total: auto + tele + pass + climb };
}

/** Least-squares slope of y over 0..n-1 (units of y per match). */
function slope(ys) {
  const n = ys.length;
  if (n < 3) return 0;
  const mx = (n - 1) / 2;
  const my = mean(ys);
  let num = 0;
  let den = 0;
  ys.forEach((y, i) => {
    num += (i - mx) * (y - my);
    den += (i - mx) * (i - mx);
  });
  return den ? num / den : 0;
}

function movementStats(runs) {
  if (!runs.length) return null;
  const per = runs.map((run) => {
    const s = run.samples;
    let dist = 0;
    let ownHalf = 0;
    const left = s.length > 0 && s[0].x < 0.5;
    for (let i = 0; i < s.length; i++) {
      if (i > 0) {
        const dx = (s[i].x - s[i - 1].x) * FIELD_M.x;
        const dy = (s[i].y - s[i - 1].y) * FIELD_M.y;
        dist += Math.hypot(dx, dy);
      }
      if (left ? s[i].x < 0.5 : s[i].x >= 0.5) ownHalf++;
    }
    const dur = s.length > 1 ? s[s.length - 1].time - s[0].time : 0;
    return { matchNumber: run.matchNumber, distance: dist, duration: dur, speed: dur > 0 ? dist / dur : 0, ownHalf: s.length ? ownHalf / s.length : 0 };
  });
  return {
    runs: per.length,
    avgDistance: mean(per.map((p) => p.distance)),
    avgSpeed: mean(per.map((p) => p.speed)),
    ownHalfShare: mean(per.map((p) => p.ownHalf)),
    per,
  };
}

/** @returns profile for one team from its match records (sorted) and path runs */
function buildProfile(records, runs = []) {
  const recs = [...records].sort((a, b) => byNatural(a.matchNumber, b.matchNumber));
  const n = recs.length;
  const pts = recs.map(pointsBreakdown);
  const totals = pts.map((p) => p.total);
  const autoMade = sum(recs.map((m) => m.autoHub));
  const autoMiss = sum(recs.map((m) => m.autoHubMissed));
  const teleMade = sum(recs.map((m) => m.teleOpHub));
  const teleMiss = sum(recs.map((m) => m.teleOpHubMissed));
  const acc = (made, miss) => (made + miss ? made / (made + miss) : 0);

  const climbs = recs.map((m) => m.teleOpClimb);
  const attempts = climbs.filter((c) => c >= 1).length;
  const successes = climbs.filter((c) => c >= 2).length;
  const levelCounts = { none: climbs.filter((c) => c === 0).length, fail: climbs.filter((c) => c === 1).length, l1: climbs.filter((c) => c === 2).length, l2: climbs.filter((c) => c === 3).length, l3: climbs.filter((c) => c === 4).length };

  const broke = recs.map((m) => m.brokeDuration);
  const underDef = recs.map((m) => m.underDefDuration);
  const meanTotal = mean(totals);
  const defended = totals.filter((_, i) => underDef[i] >= 10);
  const free = totals.filter((_, i) => underDef[i] < 10);

  let bestIdx = 0;
  let worstIdx = 0;
  totals.forEach((t, i) => {
    if (t > totals[bestIdx]) bestIdx = i;
    if (t < totals[worstIdx]) worstIdx = i;
  });

  const last3 = totals.slice(-3);
  return {
    matches: n,
    records: recs,
    perMatch: recs.map((m, i) => ({ matchNumber: m.matchNumber, ...pts[i], efficiency: shootingEfficiency(m), broke: broke[i], underDef: underDef[i], climbLevel: m.teleOpClimb, attempts: m.autoHub + m.autoHubMissed + m.teleOpHub + m.teleOpHubMissed })),
    avg: {
      total: meanTotal,
      auto: mean(pts.map((p) => p.auto)),
      tele: mean(pts.map((p) => p.tele)),
      pass: mean(pts.map((p) => p.pass)),
      climb: mean(pts.map((p) => p.climb)),
      autoFuel: mean(recs.map((m) => m.autoHub)),
      teleFuel: mean(recs.map((m) => m.teleOpHub)),
      passed: mean(recs.map((m) => m.teleOpPassed)),
      shots: mean(recs.map((m) => m.autoHub + m.autoHubMissed + m.teleOpHub + m.teleOpHubMissed)),
    },
    accuracy: { auto: acc(autoMade, autoMiss), tele: acc(teleMade, teleMiss), overall: acc(autoMade + teleMade, autoMiss + teleMiss) },
    climb: { attempts, successes, attemptRate: n ? attempts / n : 0, successRate: attempts ? successes / attempts : 0, rate: n ? successes / n : 0, highRate: n ? levelCounts.l2 / n + levelCounts.l3 / n : 0, autoRate: n ? recs.filter((m) => m.autoClimb > 1).length / n : 0, levels: levelCounts },
    reliability: {
      avgDown: mean(broke),
      uptime: 1 - mean(broke) / MATCH_SECONDS,
      downMatches: n ? broke.filter((b) => b > 0).length / n : 0,
      sd: sd(totals),
      cv: meanTotal > 0 ? sd(totals) / meanTotal : 0,
      floor: n ? Math.min(...totals) : 0,
      ceiling: n ? Math.max(...totals) : 0,
      median: n ? [...totals].sort((a, b) => a - b)[Math.floor((n - 1) / 2)] : 0,
    },
    defense: { rating: mean(recs.map((m) => m.defEffectiveness)), time: mean(recs.map((m) => m.defDuration)), underDef: mean(underDef), defendedDelta: defended.length && free.length ? mean(defended) - mean(free) : null, defendedMatches: defended.length },
    form: { slope: slope(totals), last3: last3.length ? mean(last3) : 0, vsAvg: last3.length ? mean(last3) - meanTotal : 0 },
    best: n ? { matchNumber: recs[bestIdx].matchNumber, points: totals[bestIdx] } : null,
    worst: n ? { matchNumber: recs[worstIdx].matchNumber, points: totals[worstIdx] } : null,
    movement: movementStats(runs),
  };
}

/** Metrics ranked across the whole field. `get` pulls a number from {profile, summary}. */
const METRICS = [
  { id: 'score', label: 'Total scoring', unit: 'pts', higher: true, get: (p) => p.avg.total },
  { id: 'auto', label: 'Autonomous', unit: 'pts', higher: true, get: (p) => p.avg.auto },
  { id: 'tele', label: 'Teleop scoring', unit: 'pts', higher: true, get: (p) => p.avg.tele },
  { id: 'volume', label: 'Shot volume', unit: 'shots', higher: true, get: (p) => p.avg.shots },
  { id: 'accuracy', label: 'Shooting accuracy', pct: true, higher: true, get: (p) => p.accuracy.overall },
  { id: 'endgame', label: 'Endgame points', unit: 'pts', higher: true, get: (p) => p.avg.climb },
  { id: 'climb', label: 'Climb success', pct: true, higher: true, get: (p) => p.climb.rate },
  { id: 'uptime', label: 'Uptime', pct: true, higher: true, get: (p) => p.reliability.uptime },
  { id: 'consistency', label: 'Consistency', pct: true, higher: true, get: (p) => Math.max(0, 1 - p.reliability.cv) },
  { id: 'defense', label: 'Defense', unit: '/5', higher: true, get: (p) => p.defense.rating },
];

/** Percentile (0..100) of v within `all`; ties share the middle rank. */
function percentile(all, v, higher = true) {
  if (!all.length) return 50;
  let below = 0;
  let equal = 0;
  for (const x of all) {
    if (x < v) below++;
    else if (x === v) equal++;
  }
  const p = ((below + equal / 2) / all.length) * 100;
  return higher ? p : 100 - p;
}

/** Builds profiles for every team plus each team's percentile on every metric. */
function buildField(matches, paths, summaries) {
  const byTeam = new Map();
  for (const m of matches) {
    if (!byTeam.has(m.teamNumber)) byTeam.set(m.teamNumber, []);
    byTeam.get(m.teamNumber).push(m);
  }
  const pathsBy = new Map();
  for (const r of paths) {
    if (!pathsBy.has(r.teamNumber)) pathsBy.set(r.teamNumber, []);
    pathsBy.get(r.teamNumber).push(r);
  }
  const profiles = new Map();
  for (const [team, recs] of byTeam) profiles.set(team, buildProfile(recs, pathsBy.get(team) || []));
  for (const [team, runs] of pathsBy) if (!profiles.has(team)) profiles.set(team, buildProfile([], runs));

  const rated = [...profiles.entries()].filter(([, p]) => p.matches > 0);
  const ranks = new Map();
  for (const [team, p] of rated) {
    const r = {};
    for (const m of METRICS) {
      const all = rated.map(([, q]) => m.get(q));
      r[m.id] = { value: m.get(p), pct: percentile(all, m.get(p), m.higher), rank: all.filter((x) => (m.higher ? x > m.get(p) : x < m.get(p))).length + 1, of: all.length };
    }
    // Composite axes for the radar chart.
    const sm = summaries.find((s) => s.teamNumber === team);
    const reliabilityAll = rated.map(([t]) => (summaries.find((s) => s.teamNumber === t) || {}).reliability || 0);
    r.radar = {
      Scoring: r.score.pct,
      Auto: r.auto.pct,
      Accuracy: r.accuracy.pct,
      Endgame: (r.endgame.pct + r.climb.pct) / 2,
      Reliability: sm ? percentile(reliabilityAll, sm.reliability, true) : 50,
      Defense: r.defense.pct,
    };
    ranks.set(team, r);
  }
  return { profiles, ranks, size: rated.length };
}

/** Plain-language strengths and watch-outs from percentiles. */
function insights(profile, rank) {
  if (!profile || !rank || profile.matches === 0) return { strengths: [], risks: [] };
  const fmt1 = (v) => v.toFixed(1);
  const pctS = (v) => `${Math.round(v * 100)}%`;
  const top = (id) => `top ${Math.max(1, Math.round(100 - rank[id].pct))}%`;
  const strengths = [];
  const risks = [];

  if (rank.score.pct >= 80) strengths.push(`Elite scorer — ${top('score')} at ${fmt1(profile.avg.total)} pts per match.`);
  if (rank.auto.pct >= 80) strengths.push(`Strong autonomous (${top('auto')}): ${fmt1(profile.avg.auto)} pts on average.`);
  if (rank.accuracy.pct >= 80) strengths.push(`Accurate shooter — ${pctS(profile.accuracy.overall)} of attempts go in (${top('accuracy')}).`);
  if (rank.volume.pct >= 80) strengths.push(`High cycle volume: ${fmt1(profile.avg.shots)} shots per match.`);
  if (profile.climb.attempts >= 2 && profile.climb.successRate >= 0.8) strengths.push(`Dependable climber — succeeds on ${pctS(profile.climb.successRate)} of attempts.`);
  if (rank.uptime.pct >= 80 && profile.reliability.avgDown < 5) strengths.push(`Rarely down: ${pctS(profile.reliability.uptime)} uptime.`);
  if (rank.consistency.pct >= 80 && profile.matches >= 3) strengths.push(`Very consistent — scores stay within ±${fmt1(profile.reliability.sd)} pts.`);
  if (rank.defense.pct >= 80 && profile.defense.rating >= 2.5) strengths.push(`Effective defender (rated ${fmt1(profile.defense.rating)}/5).`);
  if (profile.form.vsAvg > 4 && profile.matches >= 4) strengths.push(`Trending up: last 3 matches are ${fmt1(profile.form.vsAvg)} pts above their average.`);

  if (rank.score.pct <= 25) risks.push(`Low scoring output (bottom ${Math.max(1, Math.round(rank.score.pct))}%): ${fmt1(profile.avg.total)} pts per match.`);
  if (rank.accuracy.pct <= 25 && profile.avg.shots >= 3) risks.push(`Misses a lot — only ${pctS(profile.accuracy.overall)} accuracy.`);
  if (profile.reliability.downMatches >= 0.34 && profile.matches >= 3) risks.push(`Breaks down often — down in ${pctS(profile.reliability.downMatches)} of matches (${fmt1(profile.reliability.avgDown)}s average).`);
  if (rank.consistency.pct <= 25 && profile.matches >= 3) risks.push(`Swingy results: ${fmt1(profile.reliability.floor)}–${fmt1(profile.reliability.ceiling)} pts range.`);
  if (profile.climb.attempts >= 2 && profile.climb.successRate < 0.5) risks.push(`Climb is unreliable — only ${pctS(profile.climb.successRate)} of attempts succeed.`);
  if (profile.climb.attemptRate < 0.3 && profile.matches >= 3) risks.push('Rarely attempts the endgame climb.');
  if (profile.defense.defendedDelta !== null && profile.defense.defendedDelta < -4) risks.push(`Struggles against defense: ${fmt1(Math.abs(profile.defense.defendedDelta))} pts lower when defended.`);
  if (profile.form.vsAvg < -4 && profile.matches >= 4) risks.push(`Trending down: last 3 matches are ${fmt1(Math.abs(profile.form.vsAvg))} pts under their average.`);
  if (profile.matches < 3) risks.push(`Small sample — only ${profile.matches} match${profile.matches === 1 ? '' : 'es'} scouted.`);

  return { strengths: strengths.slice(0, 5), risks: risks.slice(0, 5) };
}

module.exports = { METRICS, FIELD_M, buildProfile, buildField, percentile, insights, pointsBreakdown, slope };
