// The Android/web scanner's frame assembler must rebuild the pack exactly, whatever order the frames arrive in.
const fs = require('fs');
const assert = require('assert');
const { Assembler, inflateText } = require('../src/resources/coach/frames.js');
const { makeFrames } = require('../src/shared/qrframes.js');
const zlib = require('zlib');

const frames = fs.readFileSync(__dirname + '/qr/frames.txt', 'utf8').split('\n').filter(Boolean);
const expected = JSON.parse(fs.readFileSync(__dirname + '/qr/expected.json', 'utf8'));
const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);

async function run(list, label) {
  const asm = new Assembler();
  let done;
  for (const f of list) { const r = asm.add(f); if (r.state === 'complete') { done = r; break; } }
  assert(done, `${label}: never completed`);
  assert.deepStrictEqual(JSON.parse(await inflateText(done.bytes)), expected, `${label}: wrong data`);
  console.log('ok -', label);
}

(async () => {
  await run(frames, 'in order');
  await run(shuffle(frames), 'shuffled');
  await run([...shuffle(frames), ...frames], 'with repeats (loop starts anywhere)');
  // a stray frame from another session in the middle must not wipe progress
  const stray = makeFrames(zlib.deflateRawSync(Buffer.from('{}')), { session: 'zzzz', chunk: 50 })[0];
  const mixed = [...frames.slice(0, 6), stray, ...frames.slice(6)];
  await run(mixed, 'one stray misread frame');
  // a corrupted slice is detected by the checksum
  const bad = frames.slice();
  bad[3] = bad[3].replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  const asm = new Assembler();
  const states = bad.map((f) => asm.add(f).state);
  assert.strictEqual(states[states.length - 1], 'failed', 'corruption not caught');
  console.log('ok - corrupted frame rejected');
  // new data (new session id) replaces the old once it repeats
  const next = makeFrames(zlib.deflateRawSync(Buffer.from('{"format":"packout-coach","n":2}')), { session: 'beef', chunk: 20 });
  const a2 = new Assembler();
  frames.slice(0, 5).forEach((f) => a2.add(f));
  let out;
  for (const f of [...next, ...next]) { const r = a2.add(f); if (r.state === 'complete') out = r; }
  assert(out && JSON.parse(await inflateText(out.bytes)).n === 2, 'did not switch to the new session');
  console.log('ok - switches to a fresh session');
})().catch((e) => { console.error(e); process.exit(1); });
