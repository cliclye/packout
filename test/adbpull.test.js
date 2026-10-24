// Pulling from a phone must add to what is already on this computer, never wipe it.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-adb-'));
const remote = {}; // device -> { remoteFolder -> {name: content} }
const util = require('../src/main/util');
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { app: { getPath: () => tmp } };
  if (req === './util') {
    return { ...util, capture: async (_adb, args) => {
      // adb -s <device> pull <remote file> <dest dir>
      const dev = args[1], src = args[3], dest = args[4];
      const name = path.basename(src), folder = path.dirname(src);
      const content = remote[dev] && remote[dev][folder] && remote[dev][folder][name];
      if (content === undefined) return { code: 1, tail: 'no such file' };
      fs.writeFileSync(path.join(dest, name), content);
      return { code: 0, tail: '' };
    } };
  }
  return realLoad.call(this, req, ...rest);
};
const { _pullFolder: pull } = require('../src/main/adb');
Module._load = realLoad;

const PIT = { remote: '/sdcard/Documents/PitData', local: 'PitData', mirrorDeletes: false };
const MATCH = { remote: '/sdcard/Documents/ScoutingData', local: 'ScoutingData', mirrorDeletes: true };
const files = (f) => fs.readdirSync(path.join(tmp, 'phone-data', f.local)).sort();

(async () => {
  remote.A = { [PIT.remote]: { 'pit_1.json': 'a1', 'pit_2.json': 'a2' }, [MATCH.remote]: { 'm1.json': '1', 'm2.json': '2' } };
  remote.B = { [PIT.remote]: { 'pit_3.json': 'b3' }, [MATCH.remote]: { 'm9.json': '9' } };

  await pull('adb', 'A', PIT, ['pit_1.json', 'pit_2.json']);
  const r = await pull('adb', 'B', PIT, ['pit_3.json']);
  assert.deepStrictEqual(files(PIT), ['pit_1.json', 'pit_2.json', 'pit_3.json'], 'pit data from phone B must not erase phone A');
  assert.deepStrictEqual(r.removed, []);

  // phone A now shows an empty pit folder (e.g. wiped / not scouted yet): nothing local is deleted
  await pull('adb', 'A', PIT, []);
  assert.deepStrictEqual(files(PIT), ['pit_1.json', 'pit_2.json', 'pit_3.json'], 'an empty pit folder must not delete anything');

  // match data: phone B's pull never removes phone A's files; a file deleted on its own phone is mirrored
  await pull('adb', 'A', MATCH, ['m1.json', 'm2.json']);
  await pull('adb', 'B', MATCH, ['m9.json']);
  assert.deepStrictEqual(files(MATCH), ['m1.json', 'm2.json', 'm9.json']);
  const del = await pull('adb', 'A', MATCH, ['m1.json']); // m2 deleted on phone A
  assert.deepStrictEqual(files(MATCH), ['m1.json', 'm9.json']);
  assert.strictEqual(del.removed.length, 1);
  assert(del.removed[0].endsWith('m2.json'));

  // a pre-existing local file that no phone ever reported is left alone
  fs.writeFileSync(path.join(tmp, 'phone-data', 'ScoutingData', 'old.json'), 'x');
  await pull('adb', 'A', MATCH, ['m1.json']);
  assert(files(MATCH).includes('old.json'));
  console.log('ok - phone pulls only add; match deletions mirror per phone');
})().catch((e) => { console.error(e); process.exit(1); });
