/** Demo data so every screen can be explored without real scouting files. */
const { normalizeMatch, normalizePit, normalizePathRun } = require('./models');

// Small deterministic PRNG so the demo looks the same every time.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const TEAMS = ['971', '1540', '2471', '2990', '2910', '1425', '254', '1678', '4414', '1323'];
const MATCHES = ['12', '13', '14', '23', '30'];

function sampleMatches() {
  const out = [];
  MATCHES.forEach((match, mi) => {
    TEAMS.forEach((team, ti) => {
      const r = rng(ti * 97 + mi * 13 + 7);
      const skill = 1 - ti * 0.085;
      const broke = r() < 0.07 ? 18 + Math.floor(r() * 30) : 0;
      out.push(
        normalizeMatch({
          id: `sample:${team}-${match}`,
          teamNumber: team,
          matchNumber: match,
          autoHub: Math.round(3 + 4 * skill * r()),
          autoHubMissed: Math.round(r() * 3),
          autoClimb: r() > 0.7 ? 2 : 0,
          teleOpHub: Math.round(6 + 12 * skill * (0.6 + r() * 0.5)),
          teleOpHubMissed: Math.round(1 + r() * 5),
          teleOpPassed: Math.round(r() * 5),
          teleOpClimb: [0, 2, 3, 4, 4, 3][Math.floor(r() * 6)] || 2,
          defEffectiveness: Math.round(r() * 4),
          defDuration: Math.round(r() * 40),
          brokeDuration: broke,
          underDefDuration: Math.round(r() * 20),
          notes: broke ? 'Lost comms mid-match, brownout noted on field.' : ti === 0 ? 'Flagship cycle pace; strong defense when needed.' : '',
          scouterName: 'Demo',
        })
      );
    });
  });
  return out;
}

function samplePits() {
  const rows = [
    ['971', 2, 4, 3, 30, 2, 'Heavy cycle strategy, prioritized L3.'],
    ['1540', 2, 3, 2, 28, 1, 'Fast swaps, narrower frame.'],
    ['2471', 2, 5, 3, 31, 3, 'Under-bumper collector, climb focus.'],
    ['2990', 1, 2, 1, 27, 0, 'Newer build; improving each match.'],
    ['254', 2, 4, 4, 29, 3, 'Fully adjustable launcher, very consistent.'],
  ];
  return rows.map(([team, driveTrain, intake, launcher, width, terrain, notes]) =>
    normalizePit({ id: `sample:pit-${team}`, teamNumber: team, driveTrain, intake, launcher, width, terrain, notes })
  );
}

/** A believable cycle: start zone -> hub -> source -> hub ... with a late move to the climb. */
function samplePaths() {
  const out = [];
  TEAMS.slice(0, 6).forEach((team, ti) => {
    ['12', '23'].forEach((match, mi) => {
      const r = rng(ti * 31 + mi * 7 + 3);
      const left = (ti + mi) % 2 === 0;
      const sx = left ? 0.12 : 0.88;
      const hub = { x: left ? 0.34 : 0.66, y: 0.3 + r() * 0.4 };
      const src = { x: left ? 0.06 : 0.94, y: 0.15 + r() * 0.7 };
      const samples = [];
      let t = 0;
      let pos = { x: sx, y: 0.2 + r() * 0.6 };
      const goTo = (target, seconds, isAuto) => {
        const steps = Math.max(2, Math.round(seconds / 0.167));
        const from = pos;
        for (let i = 1; i <= steps; i++) {
          const f = i / steps;
          const ease = f * f * (3 - 2 * f);
          samples.push({
            isAuto,
            x: from.x + (target.x - from.x) * ease + (r() - 0.5) * 0.004,
            y: from.y + (target.y - from.y) * ease + Math.sin(f * Math.PI) * 0.05 * (r() - 0.3),
            time: +(t + f * seconds).toFixed(3),
          });
        }
        t += seconds;
        pos = target;
      };
      samples.push({ isAuto: true, x: pos.x, y: pos.y, time: 0 });
      goTo(hub, 4, true);
      goTo({ x: hub.x + (left ? 0.1 : -0.1), y: hub.y + (r() - 0.5) * 0.3 }, 5, true);
      goTo(hub, 5, true);
      for (let c = 0; c < 6; c++) {
        goTo({ x: src.x + (left ? 0.04 : -0.04), y: src.y + (r() - 0.5) * 0.2 }, 6 + r() * 3, false);
        goTo({ x: hub.x + (r() - 0.5) * 0.08, y: hub.y + (r() - 0.5) * 0.25 }, 5 + r() * 3, false);
      }
      goTo({ x: 0.5, y: 0.5 + (r() - 0.5) * 0.3 }, 6, false);
      out.push(
        normalizePathRun({ id: `sample:path-${team}-${match}`, teamNumber: team, matchNumber: match, source: 'sample', samples })
      );
    });
  });
  return out;
}

module.exports = { sampleMatches, samplePits, samplePaths };
