'use strict';
// Records written by a Scout Studio design import as normal match/pit records plus `custom`.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isDesignRecord, designToRaw, teamTable, pointsFor } = require('../src/shared/designSchema');
const { normalizeMatch, normalizePit } = require('../src/shared/models');

const rec = (team, match, auto, shots) => ({
  formatVersion: 1, form: 'match', design: 'Test|2027', meta: { team, match, scouter: 'Sam', station: 'Red 1' },
  values: { auto_scored: auto, notes: 'ok' }, events: { shots: shots || [] }, computed: { total: auto * 2 },
  legacy: { autoHub: auto, notes: 'ok' },
});

assert.ok(isDesignRecord(rec(1, 2, 3)));
assert.ok(!isDesignRecord({ teamNumber: 1, matchNumber: 2 }));

const m = normalizeMatch(designToRaw(rec(254, 7, 5)));
assert.strictEqual(m.teamNumber, '254');
assert.strictEqual(m.matchNumber, '7');
assert.strictEqual(m.autoHub, 5, 'legacy key feeds the built-in views');
assert.strictEqual(m.scouterName, 'Sam');
assert.strictEqual(m.custom.values.auto_scored, 5);

const pit = normalizePit(designToRaw({ ...rec(254, 0, 0), form: 'pit', legacy: { driveTrain: 2, width: 28 } }));
assert.strictEqual(pit.driveTrain, 2);
assert.strictEqual(pit.width, 28);

const records = [
  normalizeMatch(designToRaw(rec(254, 1, 4, [{ t: 1, name: 'shot', x: 0.2, y: 0.4 }]))),
  normalizeMatch(designToRaw(rec(254, 2, 6, [{ t: 1, name: 'shot', x: 0.8, y: 0.1 }, { t: 2, name: 'shot', x: 0.5, y: 0.5 }]))),
  normalizeMatch(designToRaw(rec(1678, 1, 10))),
];
const { cols, rows } = teamTable(records, { forms: [{ id: 'match', fields: [{ id: 'auto_scored', label: 'Auto scored' }], computed: [{ id: 'total', label: 'Total' }] }] });
assert.deepStrictEqual(cols.map((c) => c.label), ['Auto scored', 'Total', 'shots']);
const t254 = rows.find((r) => r.team === '254');
assert.strictEqual(t254.avg['v:auto_scored'], 5);
assert.strictEqual(t254.avg['c:total'], 10);
assert.strictEqual(t254.avg['e:shots'], 1.5);
assert.strictEqual(pointsFor(records, '254', 'shots').length, 3);

// importer end-to-end (requires electron's `app`, so stub it)
require.cache[require.resolve('electron')] = { id: 'electron', filename: 'electron', loaded: true, exports: { app: { getPath: () => os.tmpdir() } } };
const { importPath } = require('../src/main/importer');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-design-'));
fs.writeFileSync(path.join(dir, 'match01_team254.json'), JSON.stringify(rec(254, 1, 4)));
fs.writeFileSync(path.join(dir, 'pit_team254.json'), JSON.stringify({ ...rec(254, 0, 0), form: 'pit', legacy: { driveTrain: 1 }, values: { photo: 'image_team254.jpg' } }));
fs.writeFileSync(path.join(dir, 'image_team254.jpg'), 'x');
fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({ teamNumber: '1', matchNumber: '2', autoHub: 3 }));
const out = importPath(dir);
assert.strictEqual(out.matchRecords.length, 2, 'design + legacy match');
assert.strictEqual(out.pitRecords.length, 1);
assert.ok(out.pitRecords[0].imagePath.endsWith('image_team254.jpg'));
assert.ok(out.matchRecords.some((r) => r.custom) && out.matchRecords.some((r) => !r.custom));
fs.rmSync(dir, { recursive: true, force: true });
console.log('design records ok');
