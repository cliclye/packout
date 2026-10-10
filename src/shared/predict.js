/**
 * Match & event prediction (our take on Statbotics' EPA-style model).
 *
 * Each team gets a rating = expected points it adds to an alliance score:
 *   1. TBA results: a ridge-regularised OPR solved from every played match
 *      (works for any event with results — no scouting needed).
 *   2. Scouting: the team's average estimated points, mapped onto the same
 *      scale by regressing against (1) across teams that have both.
 *   3. Blend: weights grow with how much data each source has, so early in an
 *      event scouting leads and later TBA results take over.
 * Win probability = Φ((μ_red − μ_blue) / σ), σ taken from honest
 * leave-one-out residuals of the model itself.
 */
const { estimatedScore } = require('./models');

const teamNum = (key) => String(key).replace(/^frc/, '');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) * (v - m), 0) / (xs.length - 1));
};

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
function Phi(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Solve A x = b by Gaussian elimination with partial pivoting (A is small & SPD). */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-9;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / d;
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / (M[r][r] || 1e-9);
  }
  return x;
}

const isPlayed = (m) => m.alliances && m.alliances.red.score >= 0 && m.alliances.blue.score >= 0;

/** Ridge OPR from alliance scores. Returns { ratings: Map team→pts, mean, played: Map team→matches } */
function ridgeOpr(matches, lambda = 2.5) {
  const rows = [];
  for (const m of matches) {
    if (!isPlayed(m)) continue;
    for (const c of ['red', 'blue']) rows.push({ teams: m.alliances[c].team_keys.map(teamNum), y: m.alliances[c].score });
  }
  const teams = [...new Set(rows.flatMap((r) => r.teams))];
  const idx = new Map(teams.map((t, i) => [t, i]));
  const n = teams.length;
  const played = new Map();
  rows.forEach((r) => r.teams.forEach((t) => played.set(t, (played.get(t) || 0) + 1)));
  if (!rows.length) return { ratings: new Map(), mean: 0, played, rows: 0 };
  const per = mean(rows.map((r) => r.y / Math.max(1, r.teams.length)));
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (const r of rows) {
    const ids = r.teams.map((t) => idx.get(t));
    for (const i of ids) {
      for (const j of ids) A[i][j] += 1;
      b[i] += r.y;
    }
  }
  for (let i = 0; i < n; i++) {
    A[i][i] += lambda;
    b[i] += lambda * per;
  }
  const x = solve(A, b);
  return { ratings: new Map(teams.map((t, i) => [t, x[i]])), mean: per, played, rows: rows.length };
}

/** Average estimated points per team from scouting, optionally ignoring one match number. */
function scoutAverages(records, excludeMatch = null) {
  const by = new Map();
  for (const r of records || []) {
    if (excludeMatch !== null && String(r.matchNumber) === String(excludeMatch)) continue;
    if (!by.has(r.teamNumber)) by.set(r.teamNumber, []);
    by.get(r.teamNumber).push(estimatedScore(r));
  }
  return new Map([...by].map(([t, xs]) => [t, { avg: mean(xs), n: xs.length }]));
}

/** a + b·scout fitted against TBA ratings; falls back to a pure ratio if the fit is unusable. */
function fitScale(scout, opr) {
  const pairs = [];
  for (const [t, s] of scout) if (opr.ratings.has(t) && (opr.played.get(t) || 0) >= 2) pairs.push([s.avg, opr.ratings.get(t)]);
  if (pairs.length < 5) return null;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let num = 0;
  let den = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    den += (x - mx) * (x - mx);
  }
  const b = den > 1e-9 ? num / den : 0;
  if (b > 0.05) return { a: my - b * mx, b, n: pairs.length, mode: 'regression' };
  return mx > 0 ? { a: 0, b: my / mx, n: pairs.length, mode: 'ratio' } : null;
}

/**
 * @param matches  TBA match objects (played ones train the model)
 * @param records  scouting match records
 * @param opts     { tbaOprs?: {oprs:{frcX:n}}, excludeMatch?: matchNumber }
 */
function buildModel(matches, records, opts = {}) {
  const opr = ridgeOpr(matches);
  const scout = scoutAverages(records, opts.excludeMatch ?? null);
  const fallbackOprs = !opr.rows && opts.tbaOprs && opts.tbaOprs.oprs ? opts.tbaOprs.oprs : null;
  const scale = scout.size ? fitScale(scout, opr) : null;
  const teamMean = opr.rows ? opr.mean : fallbackOprs ? mean(Object.values(fallbackOprs)) : 0;
  const rating = new Map();

  // Only teams actually entered in this event (scouting may include other events' teams).
  const atEvent = new Set(matches.flatMap((m) => [...m.alliances.red.team_keys, ...m.alliances.blue.team_keys].map(teamNum)));
  const all = [...opr.ratings.keys(), ...scout.keys(), ...(fallbackOprs ? Object.keys(fallbackOprs).map(teamNum) : [])];
  const teams = new Set(atEvent.size ? all.filter((t) => atEvent.has(t)) : all);
  for (const t of teams) {
    const mp = opr.played.get(t) || 0;
    const s = scout.get(t);
    const o = opr.ratings.has(t) ? opr.ratings.get(t) : fallbackOprs && fallbackOprs[`frc${t}`] !== undefined ? fallbackOprs[`frc${t}`] : null;
    const mapped = s ? (scale ? scale.a + scale.b * s.avg : s.avg) : null;
    const wo = o === null ? 0 : opr.rows ? mp / (mp + 2.5) : 0.8;
    const ws = mapped === null ? 0 : (s.n / (s.n + 1.5)) * 0.9;
    let value;
    let source;
    if (wo + ws === 0) {
      value = teamMean;
      source = 'prior';
    } else {
      value = (wo * (o ?? 0) + ws * (mapped ?? 0) + (1 - Math.min(1, wo + ws)) * teamMean) / Math.max(1, wo + ws);
      source = wo && ws ? 'blend' : wo ? 'tba' : 'scouting';
    }
    rating.set(t, { value, source, tbaMatches: mp, scoutMatches: s ? s.n : 0, opr: o, scouted: mapped });
  }
  return { rating, teamMean, scale, sigma: null, trainedOn: opr.rows / 2 };
}

const FALLBACK_SIGMA = 0.22;

function teamRating(model, t) {
  const r = model.rating.get(t);
  return r ? r.value : model.teamMean;
}

function predictMatch(model, redTeams, blueTeams) {
  const red = redTeams.map(teamNum);
  const blue = blueTeams.map(teamNum);
  const muR = red.reduce((a, t) => a + teamRating(model, t), 0);
  const muB = blue.reduce((a, t) => a + teamRating(model, t), 0);
  const sigmaA = model.sigma || Math.max(8, FALLBACK_SIGMA * ((muR + muB) / 2));
  const pRed = Phi((muR - muB) / (Math.SQRT2 * sigmaA));
  return { muR, muB, pRed, pBlue: 1 - pRed, sigma: sigmaA, favorite: muR === muB ? null : muR > muB ? 'red' : 'blue' };
}

/**
 * Leave-one-out evaluation: every played match is predicted by a model that has
 * never seen it (nor its scouting rows). Gives honest accuracy and residual σ.
 */
function backtest(matches, records) {
  const played = matches.filter(isPlayed);
  if (played.length < 6) return { n: 0, correct: 0, accuracy: null, sigma: null, hits: new Map(), brier: null };
  const hits = new Map();
  const resid = [];
  let correct = 0;
  let brier = 0;
  let scored = 0;
  for (const m of played) {
    const train = played.filter((x) => x.key !== m.key);
    const model = buildModel(train, records, { excludeMatch: m.comp_level === 'qm' ? m.match_number : null });
    const p = predictMatch(model, m.alliances.red.team_keys, m.alliances.blue.team_keys);
    const rs = m.alliances.red.score;
    const bs = m.alliances.blue.score;
    resid.push(rs - p.muR, bs - p.muB);
    if (rs === bs) {
      hits.set(m.key, { ...p, actual: 'tie' });
      continue;
    }
    const redWon = rs > bs;
    const ok = (p.pRed >= 0.5) === redWon;
    if (ok) correct++;
    brier += (p.pRed - (redWon ? 1 : 0)) ** 2;
    scored++;
    hits.set(m.key, { ...p, actual: redWon ? 'red' : 'blue', ok });
  }
  return { n: scored, correct, accuracy: scored ? correct / scored : null, sigma: sd(resid) || null, hits, brier: scored ? brier / scored : null };
}

/** Full model used for live predictions: σ comes from the backtest residuals. */
function fitModel(matches, records, opts = {}) {
  const bt = backtest(matches, records);
  const model = buildModel(matches, records, opts);
  if (bt.sigma) model.sigma = bt.sigma;
  return { model, backtest: bt };
}

/** Monte-Carlo the remaining qualification matches → expected wins and top-N odds (by wins). */
function simulateQuals(model, matches, { sims = 2000, topN = 8, seed = 7 } = {}) {
  const quals = matches.filter((m) => m.comp_level === 'qm');
  const wins = new Map();
  const teams = new Set();
  for (const m of quals) {
    for (const c of ['red', 'blue']) m.alliances[c].team_keys.forEach((k) => teams.add(teamNum(k)));
  }
  for (const t of teams) wins.set(t, 0);
  const remaining = [];
  for (const m of quals) {
    const red = m.alliances.red.team_keys.map(teamNum);
    const blue = m.alliances.blue.team_keys.map(teamNum);
    if (isPlayed(m)) {
      const r = m.alliances.red.score;
      const b = m.alliances.blue.score;
      for (const t of r > b ? red : r < b ? blue : []) wins.set(t, wins.get(t) + 1);
      if (r === b) [...red, ...blue].forEach((t) => wins.set(t, wins.get(t) + 0.5));
    } else {
      remaining.push({ red, blue, p: predictMatch(model, red, blue).pRed });
    }
  }
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const list = [...teams];
  const expected = new Map(list.map((t) => [t, wins.get(t)]));
  for (const r of remaining) {
    for (const t of r.red) expected.set(t, expected.get(t) + r.p);
    for (const t of r.blue) expected.set(t, expected.get(t) + (1 - r.p));
  }
  const topCount = new Map(list.map((t) => [t, 0]));
  const rankSum = new Map(list.map((t) => [t, 0]));
  for (let i = 0; i < sims; i++) {
    const w = new Map(wins);
    for (const r of remaining) {
      const redWon = rnd() < r.p;
      for (const t of redWon ? r.red : r.blue) w.set(t, w.get(t) + 1);
    }
    const order = list.map((t) => [t, w.get(t) + rnd() * 0.5]).sort((a, b) => b[1] - a[1]);
    order.forEach(([t], rank) => {
      rankSum.set(t, rankSum.get(t) + rank + 1);
      if (rank < topN) topCount.set(t, topCount.get(t) + 1);
    });
  }
  return list.map((t) => ({ team: t, wins: wins.get(t), expectedWins: expected.get(t), topN: topCount.get(t) / sims, avgRank: rankSum.get(t) / sims })).sort((a, b) => a.avgRank - b.avgRank);
}

module.exports = { Phi, ridgeOpr, scoutAverages, buildModel, predictMatch, backtest, fitModel, simulateQuals, teamNum };
