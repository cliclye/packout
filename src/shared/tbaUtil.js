/** TBA match helpers with no UI/Electron dependencies (shared by the app, the phone pack and tests). */
const teamNum = (key) => String(key).replace(/^frc/, '');
const LEVELS = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };

function matchLabel(m, info) {
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
const matchTime = (m) => (m.actual_time || m.predicted_time || m.time || 0) * 1000;
const played = (m) => m.alliances.red.score >= 0 && m.alliances.blue.score >= 0;
function sortMatches(ms) {
  return [...ms].sort((a, b) => LEVELS[a.comp_level] - LEVELS[b.comp_level] || (a.comp_level === 'qm' ? a.match_number - b.match_number : a.set_number - b.set_number || a.match_number - b.match_number));
}
module.exports = { teamNum, matchLabel, matchTime, played, sortMatches, LEVELS };
