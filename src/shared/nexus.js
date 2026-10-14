/** FRC Nexus helpers with no UI/Electron dependencies (shared by the Game Plan page and tests). */
const teamNum = (t) => String(t == null ? '' : t).replace(/^frc/, '');
const STEPS = [
  { id: 'queue', label: 'Queue', est: 'estimatedQueueTime', act: 'actualQueueTime', hint: 'Be at the queuing line' },
  { id: 'deck', label: 'On deck', est: 'estimatedOnDeckTime', act: 'actualOnDeckTime', hint: 'Robot to the field entrance' },
  { id: 'field', label: 'On field', est: 'estimatedOnFieldTime', act: 'actualOnFieldTime', hint: 'Robot onto the field' },
  { id: 'start', label: 'Match start', est: 'estimatedStartTime', act: 'actualStartTime', hint: '3 – 2 – 1 – Go' },
];

const sameSet = (a, b) => a.length === b.length && a.every((t) => b.includes(t));

/** Nexus label we expect for a TBA match (Nexus numbers double-elim playoffs by set). */
function expectedLabel(m) {
  switch (m.comp_level) {
    case 'qm': return `Qualification ${m.match_number}`;
    case 'sf': return `Playoff ${m.set_number}`;
    case 'f': return `Final ${m.match_number}`;
    default: return null;
  }
}

/** The Nexus match entry for a TBA-shaped match: by label first, then by the six teams. */
function findNexusMatch(nexus, m) {
  if (!nexus || !Array.isArray(nexus.matches) || !nexus.matches.length || !m) return null;
  const red = m.alliances.red.team_keys.map(teamNum);
  const blue = m.alliances.blue.team_keys.map(teamNum);
  const label = expectedLabel(m);
  const same = (n) => sameSet((n.redTeams || []).map(teamNum), red) && sameSet((n.blueTeams || []).map(teamNum), blue);
  const labelled = label ? nexus.matches.filter((n) => n.label === label || n.label === `${label} Replay`) : [];
  const pool = labelled.length ? labelled : nexus.matches.filter(same);
  // A scheduled replay supersedes the original.
  return pool.length ? pool[pool.length - 1] : null;
}

/** { color, n, label } such as { color:'red', n:2, label:'Red 2' } or null if the team isn't in the match. */
function stationOf(nm, team) {
  if (!nm) return null;
  for (const color of ['red', 'blue']) {
    const list = (nm[`${color}Teams`] || []).map(teamNum);
    const i = list.indexOf(String(team));
    if (i >= 0) return { color, n: i + 1, label: `${color === 'red' ? 'Red' : 'Blue'} ${i + 1}` };
  }
  return null;
}

/** The four queue milestones with the best-known time and whether each already happened. */
function timeline(nm) {
  const t = (nm && nm.times) || {};
  return STEPS.map((s) => ({ id: s.id, label: s.label, hint: s.hint, at: t[s.act] || t[s.est] || null, done: Boolean(t[s.act]), estimated: !t[s.act] && Boolean(t[s.est]) }));
}

/** How many matches until this one starts queuing (null if unknown or already queuing). */
function matchesUntilQueue(nexus, nm) {
  if (!nexus || !nm || nm.status !== 'Queuing soon' || !nexus.nowQueuing) return null;
  const i = nexus.matches.indexOf(nm);
  const cur = nexus.matches.findIndex((n) => n.label === nexus.nowQueuing);
  return i >= 0 && cur >= 0 ? Math.max(0, i - cur) : null;
}

module.exports = { findNexusMatch, stationOf, timeline, matchesUntilQueue, expectedLabel };
