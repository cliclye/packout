const assert = require('assert');
const { pitReportHtml, matchReportHtml } = require('../src/shared/pdfReport');
const { normalizeMatch, normalizePit } = require('../src/shared/models');
const comp = {
  name: 'Test <Event>',
  pits: [normalizePit({ teamNumber: '948', driveTrain: 2, imageData: 'data:image/jpeg;base64,AAA' }), normalizePit({ teamNumber: '488', notes: 'a<b' })],
  matches: [normalizeMatch({ teamNumber: '948', matchNumber: '11' }), normalizeMatch({ teamNumber: '488', matchNumber: '16', teleOpClimb: 3 }), normalizeMatch({ teamNumber: '488', matchNumber: '13' })],
};
const pit = pitReportHtml(comp);
assert(pit.indexOf('Team 488') < pit.indexOf('Team 948'), 'pit teams sorted');
assert(pit.includes('Swerve') && pit.includes('a&lt;b') && pit.includes('Test &lt;Event&gt;'));
const m = matchReportHtml(comp);
assert(m.indexOf('Team 488') < m.indexOf('Team 948'), 'match teams sorted');
assert(m.indexOf('<td>13</td>') < m.indexOf('<td>16</td>'), 'matches sorted');
assert(m.includes('L2'));
console.log('pdfreport ok');
