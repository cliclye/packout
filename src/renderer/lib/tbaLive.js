import { api } from '../api';

const get = async (path) => {
  const res = await api.tba.fetch(path);
  if (res.error) {
    const err = new Error(res.error);
    err.status = res.status;
    throw err;
  }
  return res;
};
const soft = async (path) => {
  try {
    return (await get(path)).data;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
};

/** Everything the Event page shows, fetched in parallel. */
export async function loadEvent(key) {
  const [info, matches, rankings, oprs, alliances, awards, teams] = await Promise.all([
    get(`/event/${key}`).then((r) => r.data),
    get(`/event/${key}/matches`).then((r) => r.data),
    soft(`/event/${key}/rankings`),
    soft(`/event/${key}/oprs`),
    soft(`/event/${key}/alliances`),
    soft(`/event/${key}/awards`),
    soft(`/event/${key}/teams/simple`),
  ]);
  return {
    info,
    matches: Array.isArray(matches) ? matches : [],
    rankings: rankings && rankings.rankings ? rankings : null,
    oprs: oprs && oprs.oprs ? oprs : null,
    alliances: Array.isArray(alliances) ? alliances : [],
    awards: Array.isArray(awards) ? awards : [],
    teams: Array.isArray(teams) ? teams : [],
    fetchedAt: Date.now(),
  };
}

export const teamNum = (key) => String(key).replace(/^frc/, '');
const LEVELS = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };
export const LEVEL_NAMES = { qm: 'Qualifications', ef: 'Eighth-finals', qf: 'Quarterfinals', sf: 'Semifinals', f: 'Finals' };

export function matchLabel(m, info) {
  const dbl = info && info.playoff_type === 10;
  switch (m.comp_level) {
    case 'qm': return `Quals ${m.match_number}`;
    case 'ef': return `EF ${m.set_number}-${m.match_number}`;
    case 'qf': return `QF ${m.set_number}-${m.match_number}`;
    case 'sf': return dbl ? `Playoff match ${m.set_number}` : `SF ${m.set_number}-${m.match_number}`;
    case 'f': return `Final ${m.match_number}`;
    default: return m.key;
  }
}

export const matchTime = (m) => (m.actual_time || m.predicted_time || m.time || 0) * 1000;

export function sortMatches(ms) {
  return [...ms].sort((a, b) => LEVELS[a.comp_level] - LEVELS[b.comp_level] || (a.comp_level === 'qm' ? a.match_number - b.match_number : a.set_number - b.set_number || a.match_number - b.match_number));
}

/** Played = has real scores. Unplayed matches carry score -1. */
export function played(m) {
  return m.alliances.red.score >= 0 && m.alliances.blue.score >= 0;
}

export function nextUp(matches) {
  const pending = sortMatches(matches).filter((m) => !played(m));
  return pending[0] || null;
}

export function lastPlayed(matches) {
  const done = sortMatches(matches).filter(played);
  return done.length ? done.sort((a, b) => matchTime(b) - matchTime(a))[0] : null;
}

export function relTime(ms, now = Date.now()) {
  if (!ms) return '';
  const d = Math.round((ms - now) / 60000);
  if (Math.abs(d) < 1) return 'now';
  const abs = Math.abs(d);
  const txt = abs >= 60 ? `${Math.floor(abs / 60)}h ${abs % 60}m` : `${abs} min`;
  return d > 0 ? `in ${txt}` : `${txt} ago`;
}

export const clock = (ms) => (ms ? new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '–');

export function videoLinks(m) {
  return (m.videos || [])
    .map((v) => (v.type === 'youtube' ? { type: 'YouTube', url: `https://www.youtube.com/watch?v=${v.key}` } : v.type === 'tba' ? { type: 'TBA', url: `https://www.thebluealliance.com/match/${m.key}` } : null))
    .filter(Boolean);
}

export const tbaMatchUrl = (m) => `https://www.thebluealliance.com/match/${m.key}`;
export const tbaTeamUrl = (n, year) => `https://www.thebluealliance.com/team/${n}/${year}`;
