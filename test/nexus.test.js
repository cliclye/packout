const assert = require('assert');
const { findNexusMatch, stationOf, timeline, matchesUntilQueue } = require('../src/shared/nexus');
const now = 1_760_000_000_000;
const nexus = {
  eventKey: 'demo1234', dataAsOfTime: now, nowQueuing: 'Qualification 24',
  matches: [
    { label: 'Qualification 24', status: 'Now queuing', redTeams: ['10', '20', '30'], blueTeams: ['40', '50', '60'], times: { estimatedQueueTime: now, actualQueueTime: now, estimatedOnDeckTime: now + 300000, estimatedOnFieldTime: now + 420000, estimatedStartTime: now + 600000 } },
    { label: 'Qualification 25', status: 'Queuing soon', redTeams: ['1294', '70', '80'], blueTeams: ['90', '100', '110'], times: { estimatedQueueTime: now + 480000, estimatedOnDeckTime: now + 780000, estimatedOnFieldTime: now + 900000, estimatedStartTime: now + 1080000 } },
    { label: 'Qualification 26', status: 'Queuing soon', redTeams: ['1', '2', '3'], blueTeams: ['4', '5', '1294'], times: {} },
    { label: 'Qualification 26 Replay', replayOf: 'Qualification 26', status: 'Queuing soon', redTeams: ['1', '2', '3'], blueTeams: ['4', '5', '1294'], times: {} },
  ],
};
const tba = (n, red, blue) => ({ comp_level: 'qm', match_number: n, set_number: 1, alliances: { red: { team_keys: red.map((t) => `frc${t}`) }, blue: { team_keys: blue.map((t) => `frc${t}`) } } });

const m25 = findNexusMatch(nexus, tba(25, ['1294', '70', '80'], ['90', '100', '110']));
assert.strictEqual(m25.label, 'Qualification 25');
assert.strictEqual(stationOf(m25, '1294').label, 'Red 1');
assert.strictEqual(stationOf(findNexusMatch(nexus, tba(26, ['1', '2', '3'], ['4', '5', '1294'])), '1294').label, 'Blue 3');
assert.strictEqual(findNexusMatch(nexus, tba(26, ['1', '2', '3'], ['4', '5', '1294'])).label, 'Qualification 26 Replay', 'replay supersedes');
assert.strictEqual(findNexusMatch(nexus, tba(99, ['7', '8', '9'], ['1', '2', '3'])), null);
// label differs but teams identical (e.g. playoffs): fall back to team sets
assert.strictEqual(findNexusMatch(nexus, { comp_level: 'ef', set_number: 1, match_number: 1, alliances: tba(0, ['10', '20', '30'], ['40', '50', '60']).alliances }).label, 'Qualification 24');
assert.strictEqual(stationOf(m25, '999'), null);
const tl = timeline(findNexusMatch(nexus, tba(24, ['10', '20', '30'], ['40', '50', '60'])));
assert.deepStrictEqual(tl.map((s) => [s.id, s.done]), [['queue', true], ['deck', false], ['field', false], ['start', false]]);
assert.strictEqual(tl[1].estimated, true);
assert.strictEqual(matchesUntilQueue(nexus, m25), 1);
assert.strictEqual(matchesUntilQueue(nexus, nexus.matches[0]), null);
console.log('ok - nexus matching, stations, timeline');
