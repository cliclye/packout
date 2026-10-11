/**
 * "Coach pack": everything a drive coach needs for the next matches, flattened into
 * plain JSON that the phone apps (Android web view + native iOS app) read offline.
 * Built on the desktop from the same models the Game Plan / Event Live pages use.
 *
 * Format v1 — see mobile/README.md. Keep additive: phones ignore unknown fields.
 */
const { predictMatch } = require('./predict');
const { buildGamePlan, teamCard } = require('./strategy');
const { teamNum, matchLabel, matchTime, played, sortMatches } = require('./tbaUtil');

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

function teamEntry(team, ctx, summary, nick) {
  const c = teamCard(team, ctx);
  const p = c.profile;
  return {
    number: team,
    name: nick || null,
    scouted: c.has,
    matches: p ? p.matches : 0,
    rank: summary ? summary.rank : null, // our scouting pick-rank
    pickScore: summary ? r1(summary.pickScore) : null,
    role: summary ? summary.role : null,
    risk: summary ? summary.riskLabel : null,
    rating: r1(c.rating),
    tbaRank: c.tba.rank,
    record: c.tba.record,
    opr: c.tba.opr === null ? null : r1(c.tba.opr),
    avgPoints: p ? r1(p.avg.total) : null,
    auto: p ? r1(p.avg.auto) : null,
    tele: p ? r1(p.avg.tele) : null,
    endgame: p ? r1(p.avg.climb) : null,
    accuracy: p ? r3(p.accuracy.overall) : null,
    climbRate: p ? r3(p.climb.rate) : null,
    uptime: p ? r3(p.reliability.uptime) : null,
    defense: p ? r1(p.defense.rating) : null,
    strengths: c.notes.strengths.slice(0, 3),
    risks: c.notes.risks.slice(0, 3),
    startLeft: c.startLeftShare === null ? null : r3(c.startLeftShare),
  };
}

/**
 * @param o { comp, summaries, field, event, fit, myTeam, notes, now }
 *   event: loaded TBA data ({info,matches,rankings,oprs,teams}) or null
 *   fit:   { model } from predict.fitModel
 */
function buildCoachPack({ comp, summaries, field, event, fit, myTeam, now = Date.now(), planCount = 8 }) {
  const info = event ? event.info : null;
  // Matches: TBA when we have it, otherwise the saved schedule (no scores).
  const raw = event
    ? sortMatches(event.matches)
    : sortMatches(
        comp.schedule.map((s) => ({
          key: `sched_${s.matchNumber}`, comp_level: 'qm', set_number: 1, match_number: s.matchNumber,
          alliances: { red: { team_keys: s.redTeams.map((t) => `frc${t}`), score: -1 }, blue: { team_keys: s.blueTeams.map((t) => `frc${t}`), score: -1 } },
          videos: [],
        }))
      );

  const ctx = { field, model: fit.model, paths: comp.paths, rankings: event ? event.rankings : null, oprs: event ? event.oprs : null };
  const nick = new Map(((event && event.teams) || []).map((t) => [String(t.team_number), t.nickname]));
  const sumBy = new Map(summaries.map((s) => [s.teamNumber, s]));

  const matches = raw.map((m) => {
    const red = m.alliances.red.team_keys.map(teamNum);
    const blue = m.alliances.blue.team_keys.map(teamNum);
    const done = played(m);
    const pred = predictMatch(fit.model, red, blue);
    const yt = (m.videos || []).find((v) => v.type === 'youtube');
    return {
      key: m.key,
      label: matchLabel(m, info),
      level: m.comp_level,
      number: m.match_number,
      time: matchTime(m) || null,
      red,
      blue,
      played: done,
      redScore: done ? m.alliances.red.score : null,
      blueScore: done ? m.alliances.blue.score : null,
      winner: done ? m.winning_alliance || 'tie' : null,
      pRed: r3(pred.pRed),
      projRed: Math.round(pred.muR),
      projBlue: Math.round(pred.muB),
      video: yt ? `https://www.youtube.com/watch?v=${yt.key}` : null,
    };
  });

  // Which teams to include: everyone in the schedule (the coach flips through opponents).
  const teamSet = new Set(matches.flatMap((m) => [...m.red, ...m.blue]));
  const teams = {};
  for (const t of teamSet) teams[t] = teamEntry(t, ctx, sumBy.get(t), nick.get(t));

  // Game plans: our team's unplayed matches (plus the last played one for review).
  const plans = {};
  if (myTeam) {
    const mine = raw.filter((m) => [...m.alliances.red.team_keys, ...m.alliances.blue.team_keys].some((k) => teamNum(k) === myTeam));
    const upcoming = mine.filter((m) => !played(m)).slice(0, planCount);
    const lastDone = mine.filter(played).slice(-1);
    for (const m of [...lastDone, ...upcoming]) {
      const red = m.alliances.red.team_keys.map(teamNum);
      const blue = m.alliances.blue.team_keys.map(teamNum);
      const pred = predictMatch(fit.model, red, blue);
      const plan = buildGamePlan({ ours: myTeam, red, blue, pred, ctx });
      plans[m.key] = {
        ourColor: plan.ourColor,
        pOurs: r3(plan.pOurs),
        ourExpected: Math.round(plan.ourExpected),
        oppExpected: Math.round(plan.oppExpected),
        topThreat: plan.topThreat,
        partners: plan.mine.map((c) => ({ team: c.team, role: c.role })),
        opponents: plan.opp.map((c) => ({ team: c.team, role: c.role, threat: r1(c.threat) })),
        recs: plan.recs.map((r) => ({ phase: r.phase, priority: r.priority, title: r.title, detail: r.detail })),
        note: (comp.strategyNotes || {})[`${myTeam}:${m.key}`] || '',
      };
    }
  }

  const rank = event && event.rankings ? event.rankings.rankings.find((r) => teamNum(r.team_key) === myTeam) : null;
  const qm = matches.filter((m) => m.level === 'qm');
  return {
    format: 'packout-coach',
    version: 1,
    generatedAt: new Date(now).toISOString(),
    competition: { name: comp.name, eventKey: comp.eventKey || '' },
    event: info ? { name: info.name, city: info.city || '', start: info.start_date, end: info.end_date } : null,
    myTeam: myTeam || '',
    summary: {
      qualsPlayed: qm.filter((m) => m.played).length,
      qualsTotal: qm.length,
      myRank: rank ? rank.rank : null,
      myRecord: rank ? `${rank.record.wins}-${rank.record.losses}-${rank.record.ties}` : null,
      model: fit.backtest && fit.backtest.accuracy !== null ? { accuracy: r3(fit.backtest.accuracy), graded: fit.backtest.n } : null,
    },
    matches,
    teams,
    plans,
    rankings: event && event.rankings ? event.rankings.rankings.slice(0, 80).map((r) => ({ rank: r.rank, team: teamNum(r.team_key), record: `${r.record.wins}-${r.record.losses}-${r.record.ties}`, played: r.matches_played })) : [],
  };
}

module.exports = { buildCoachPack };
