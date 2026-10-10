/**
 * Match game-plan generator. Pure rules over data we already have: scouting
 * profiles/percentiles (deepstats), AI robot paths, the win-probability model
 * and TBA rankings/OPR for teams nobody has scouted. Every recommendation cites
 * the numbers it is based on so the plan can be sanity-checked.
 */
const { insights } = require('./deepstats');
const { startedLeft } = require('./pathData');

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '–');
const p0 = (v) => `${Math.round(v * 100)}%`;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const by = (xs, fn) => [...xs].sort((a, b) => fn(b) - fn(a));

/** One team's card: scouting numbers when we have them, TBA/model numbers otherwise. */
function teamCard(team, ctx) {
  const profile = ctx.field.profiles.get(team);
  const has = Boolean(profile && profile.matches > 0);
  const rank = has ? ctx.field.ranks.get(team) : null;
  const tbaRank = ctx.rankings?.rankings.find((r) => r.team_key === `frc${team}`);
  const rating = ctx.model ? ctx.model.rating.get(team) : null;
  const runs = ctx.paths.filter((p) => p.teamNumber === team);
  const left = runs.filter((r) => startedLeft(r.samples)).length;
  return {
    team,
    has,
    profile: has ? profile : null,
    rank,
    notes: has ? insights(profile, rank) : { strengths: [], risks: [] },
    tba: {
      rank: tbaRank ? tbaRank.rank : null,
      record: tbaRank ? `${tbaRank.record.wins}-${tbaRank.record.losses}-${tbaRank.record.ties}` : null,
      opr: ctx.oprs?.oprs?.[`frc${team}`] ?? null,
    },
    rating: rating ? rating.value : ctx.model ? ctx.model.teamMean : 0,
    pathRuns: runs.length,
    startLeftShare: runs.length ? left / runs.length : null,
    // Points we expect them to add: scouted average when we have it, rating otherwise.
    output: has ? profile.avg.total : rating ? rating.value : 0,
  };
}

function roleOf(c, alliance) {
  if (!c.has) return 'Unscouted';
  const p = c.profile;
  const bestScorer = by(alliance.filter((x) => x.has), (x) => x.profile.avg.total)[0];
  if (bestScorer && bestScorer.team === c.team) return 'Primary scorer';
  if (p.defense.rating >= 2.5 && c.rank.defense.pct >= 60) return 'Defender';
  if (p.climb.attempts >= 2 && p.climb.successRate >= 0.8) return 'Endgame specialist';
  if (c.rank.auto.pct >= 75) return 'Auto threat';
  return 'Support';
}

function threat(c) {
  if (!c.has) return c.output;
  // Scoring plus a small bonus for dependable robots.
  return c.profile.avg.total * (0.6 + 0.4 * c.profile.reliability.uptime);
}

/**
 * @param ctx { field, model, paths, rankings, oprs }
 * @param ours  our team number, red/blue arrays of team numbers
 */
function buildGamePlan({ ours, red, blue, ctx, pred }) {
  const ourColor = red.includes(ours) ? 'red' : 'blue';
  const ourTeams = ourColor === 'red' ? red : blue;
  const oppTeams = ourColor === 'red' ? blue : red;
  const mine = ourTeams.map((t) => teamCard(t, ctx));
  const opp = oppTeams.map((t) => teamCard(t, ctx));
  mine.forEach((c) => { c.role = roleOf(c, mine); });
  opp.forEach((c) => { c.role = roleOf(c, opp); c.threat = threat(c); });
  const partners = mine.filter((c) => c.team !== ours);
  const me = mine.find((c) => c.team === ours);

  const recs = [];
  const add = (phase, priority, title, detail) => recs.push({ phase, priority, title, detail });

  const pOurs = pred ? (ourColor === 'red' ? pred.pRed : pred.pBlue) : null;
  const known = (list) => list.filter((c) => c.has);

  // ---- data gaps first: you can't plan around what you haven't seen -------------
  for (const c of [...opp, ...partners]) {
    if (!c.has) {
      const tba = [c.tba.rank ? `rank ${c.tba.rank} (${c.tba.record})` : null, c.tba.opr !== null ? `OPR ${f1(c.tba.opr)}` : null].filter(Boolean).join(', ');
      add('Scouting', c.role === 'Unscouted' && opp.includes(c) ? 'high' : 'med', `No scouting on ${c.team}`, `${opp.includes(c) ? 'Opponent' : 'Partner'} with no scouting data${tba ? ` — TBA shows ${tba}` : ''}. Our model rates them ${f1(c.rating)} pts/match. Have a scout watch them in this match.`);
    }
  }

  // ---- overall framing -------------------------------------------------------------
  if (pOurs !== null) {
    const pct = Math.round(pOurs * 100);
    if (pOurs >= 0.65) add('Overall', 'med', `Favored (${pct}%) — play clean`, 'Avoid risky climbs and penalties; the model already likes this matchup. Protect your lead in auto and endgame, keep cycling.');
    else if (pOurs >= 0.55) add('Overall', 'med', `Slight edge (${pct}%) — don’t give it away`, 'You’re ahead on paper but it’s close. A failed auto or a missed climb is enough to flip it; the plan below targets the swing factors.');
    else if (pOurs > 0.45) add('Overall', 'med', `Toss-up (${pct}%) — details decide it`, 'Auto, endgame and avoiding downtime are likely the swing factors; the plan below targets those.');
    else if (pOurs > 0.35) add('Overall', 'high', `Slight underdog (${pct}%) — find an edge`, 'Look for the matchup where you can gain points: defend their top scorer, win auto, and make sure every partner climbs.');
    else add('Overall', 'high', `Underdog (${pct}%) — we need an edge`, 'Take calculated risks: commit a robot to defending their top scorer, push cycle speed, and make sure every partner attempts the highest reliable climb.');
  }

  // ---- defense -----------------------------------------------------------------------
  const targets = by(opp, (c) => c.threat);
  const top = targets[0];
  const defenders = by(mine.filter((c) => c.has), (c) => c.profile.defense.rating * 1.0 + c.rank.defense.pct / 50 - (c.profile.avg.total / Math.max(1, sum(mine.filter((x) => x.has).map((x) => x.profile.avg.total)))) * 3);
  const defender = defenders.find((c) => c.profile.defense.rating >= 1.5) || null;
  if (top && top.has) {
    const delta = top.profile.defense.defendedDelta;
    const thin = top.profile.matches < 3 ? ` (only ${top.profile.matches} scouted match${top.profile.matches === 1 ? '' : 'es'} — treat as a rough guide)` : '';
    const why = `${top.team} averages ${f1(top.profile.avg.total)} pts at ${p0(top.profile.accuracy.overall)} accuracy${thin}`;
    if (defender) {
      const same = defender.team === ours;
      add('Defense', 'high', `${same ? 'You' : `Have ${defender.team}`} defend ${top.team}`, `${why}${delta !== null && delta < -3 ? `; they drop ${f1(Math.abs(delta))} pts when defended` : ''}. ${defender.team} is the best defender here (rating ${f1(defender.profile.defense.rating)}/5, ${defender.profile.defense.time ? `${Math.round(defender.profile.defense.time)}s per match playing D` : 'defense experience on record'}).`);
    } else {
      add('Defense', 'med', `No proven defender — be selective`, `${why}. Nobody on your alliance has a defense rating above 1.5/5, so only commit a robot to D if it won’t cost you cycles${delta !== null && delta < -3 ? ` — though ${top.team} loses ${f1(Math.abs(delta))} pts when defended, so it may be worth it` : ''}.`);
    }
    if (top.profile.reliability.downMatches >= 0.34) add('Defense', 'low', `${top.team} breaks down often`, `Down in ${p0(top.profile.reliability.downMatches)} of their matches (${f1(top.profile.reliability.avgDown)}s average). If they go dead early, switch your defender back to scoring.`);
  }
  const weakAcc = opp.filter((c) => c.has && c.profile.avg.shots >= 5 && c.profile.accuracy.overall < 0.6);
  for (const c of weakAcc) add('Defense', 'low', `${c.team} misses a lot`, `Only ${p0(c.profile.accuracy.overall)} accuracy on ${f1(c.profile.avg.shots)} shots per match — they waste cycles, so you don’t need to over-commit defense against them.`);

  // ---- autonomous --------------------------------------------------------------------
  const ourAuto = sum(known(mine).map((c) => c.profile.avg.auto));
  const oppAuto = sum(known(opp).map((c) => c.profile.avg.auto));
  if (known(mine).length && known(opp).length) {
    const gap = oppAuto - ourAuto;
    const bestAuto = by(known(mine), (c) => c.profile.avg.auto)[0];
    if (gap > 3) add('Auto', 'high', `Opponents out-score us in auto by ~${f1(gap)} pts`, `Expected auto: us ${f1(ourAuto)} vs them ${f1(oppAuto)}. Make sure ${bestAuto.team} (${f1(bestAuto.profile.avg.auto)} auto pts) runs their strongest routine and the others don’t cross its lane; consider a conservative auto from weaker robots to avoid collisions.`);
    else if (gap < -3) add('Auto', 'med', `Auto advantage (+${f1(-gap)} pts)`, `Expected auto: us ${f1(ourAuto)} vs them ${f1(oppAuto)}. Run your normal routines cleanly — a fumbled auto is the main way to give this back.`);
    else add('Auto', 'low', 'Auto is even', `Expected auto: us ${f1(ourAuto)} vs them ${f1(oppAuto)}.`);
  }
  const lanes = opp.filter((c) => c.startLeftShare !== null && (c.startLeftShare >= 0.67 || c.startLeftShare <= 0.33));
  if (lanes.length) {
    const txt = lanes.map((c) => `${c.team} usually starts ${c.startLeftShare >= 0.67 ? 'on the left' : 'on the right'} (${c.pathRuns} tracked matches)`).join(', ');
    add('Auto', 'low', 'Opponent start tendencies (from AI paths)', `${txt}. Plan lane conflicts and early defense around that.`);
  }

  // ---- teleop ------------------------------------------------------------------------
  if (known(mine).length && known(opp).length) {
    const ourTele = sum(known(mine).map((c) => c.profile.avg.tele + c.profile.avg.pass));
    const oppTele = sum(known(opp).map((c) => c.profile.avg.tele + c.profile.avg.pass));
    const scorer = by(known(mine), (c) => c.profile.avg.tele)[0];
    add('Teleop', ourTele < oppTele ? 'high' : 'med', `Teleop outlook: ${f1(ourTele)} vs ${f1(oppTele)} pts`, `${scorer.team} is your top teleop scorer (${f1(scorer.profile.avg.tele)} teleop pts, ${p0(scorer.profile.accuracy.tele)} accuracy) — keep their cycles clear of traffic${ourTele < oppTele ? '. You’re behind on paper, so look to speed up cycles and use passing from partners.' : '.'}`);
    const passer = by(known(mine), (c) => c.profile.avg.passed)[0];
    if (passer && passer.profile.avg.passed >= 2 && passer.team !== scorer.team) add('Teleop', 'low', `Use ${passer.team}’s passing`, `${passer.team} averages ${f1(passer.profile.avg.passed)} passes per match — feed ${scorer.team} to keep their cycle going.`);
  }

  // ---- endgame -----------------------------------------------------------------------
  if (known(mine).length && known(opp).length) {
    const ourEnd = sum(known(mine).map((c) => c.profile.avg.climb));
    const oppEnd = sum(known(opp).map((c) => c.profile.avg.climb));
    const rare = known(mine).filter((c) => c.profile.climb.attemptRate < 0.4 && c.profile.matches >= 3);
    if (oppEnd > ourEnd + 3) add('Endgame', 'high', `They out-climb us by ~${f1(oppEnd - ourEnd)} pts`, `Expected endgame: us ${f1(ourEnd)} vs them ${f1(oppEnd)}.${rare.length ? ` ${rare.map((c) => c.team).join(', ')} rarely attempt a climb (${rare.map((c) => p0(c.profile.climb.attemptRate)).join(', ')}) — climbing is worth it this match.` : ' Get every robot into a climb with ~20s left.'}`);
    else add('Endgame', 'med', `Endgame ${ourEnd >= oppEnd ? 'edge' : 'roughly even'}: ${f1(ourEnd)} vs ${f1(oppEnd)} pts`, rare.length ? `${rare.map((c) => c.team).join(', ')} rarely climb — decide early who is climbing so nobody blocks the tower.` : 'Everyone on your alliance usually climbs; start the climb on time and avoid failed attempts.');
    const shaky = known(mine).filter((c) => c.profile.climb.attempts >= 2 && c.profile.climb.successRate < 0.6);
    for (const c of shaky) add('Endgame', 'med', `${c.team}’s climb is unreliable`, `Succeeds on ${p0(c.profile.climb.successRate)} of attempts — have them go for the lower level that they make consistently.`);
  }

  // ---- risk --------------------------------------------------------------------------
  for (const c of known(partners)) {
    if (c.profile.reliability.downMatches >= 0.34 && c.profile.matches >= 3) add('Risk', 'high', `${c.team} often goes down`, `Down in ${p0(c.profile.reliability.downMatches)} of matches (${f1(c.profile.reliability.avgDown)}s average). Agree on a plan B: if they die, ${me && me.team !== c.team ? `you` : 'the other partners'} pick up their role.`);
    if (c.profile.defense.defendedDelta !== null && c.profile.defense.defendedDelta < -4) add('Risk', 'med', `${c.team} struggles against defense`, `Scores ${f1(Math.abs(c.profile.defense.defendedDelta))} pts less when defended — screen them or give them open lanes.`);
  }
  if (me && me.has) {
    const mn = me.notes;
    if (mn.risks.length) add('Risk', 'low', `Watch-outs for you (${me.team})`, mn.risks.slice(0, 2).join(' '));
  }

  const order = { high: 0, med: 1, low: 2 };
  recs.sort((a, b) => order[a.priority] - order[b.priority]);

  const ourExpected = sum(mine.map((c) => c.output));
  const oppExpected = sum(opp.map((c) => c.output));
  return { ourColor, mine, opp, recs, pOurs, ourExpected, oppExpected, topThreat: top ? top.team : null };
}

module.exports = { buildGamePlan, teamCard, roleOf };
