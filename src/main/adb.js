const os = require('os');
const path = require('path');
const { findCommand, capture, ensureDir } = require('./util');

/**
 * Pulls scouting data off Android phones running the Packout scouting app.
 * The app drops `newDataFlag.txt` next to its JSON files when there is something
 * new; we copy the folder and remove the flag (same protocol as the Mac app).
 */
const FOLDERS = [
  { remote: '/sdcard/Documents/ScoutingData', local: 'ScoutingData', label: 'match data' },
  { remote: '/sdcard/Documents/PitData', local: 'PitData', label: 'pit data' },
];
const POLL_MS = 2000;

let timer = null;
let busy = false;
let devices = [];
let emit = () => {};

function adbPath() {
  return findCommand(['adb']);
}

function status() {
  return { available: Boolean(adbPath()), running: Boolean(timer), devices };
}

async function listDevices(adb) {
  const res = await capture(adb, ['devices']);
  return res.stdout
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2 && p[1] === 'device')
    .map((p) => p[0]);
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const adb = adbPath();
    if (!adb) return;
    const found = await listDevices(adb);
    if (found.join() !== devices.join()) {
      devices = found;
      emit({ type: 'devices', devices });
      emit({ type: 'log', message: found.length ? `Connected: ${found.join(', ')}` : 'No devices connected' });
    }
    for (const device of found) {
      for (const f of FOLDERS) {
        const flag = `${f.remote}/newDataFlag.txt`;
        const has = await capture(adb, ['-s', device, 'shell', 'test', '-f', flag]);
        if (has.code !== 0) continue;
        const dest = ensureDir(path.join(os.homedir(), 'Documents', f.local));
        const pull = await capture(adb, ['-s', device, 'pull', `${f.remote}/.`, dest]);
        if (pull.code === 0) {
          await capture(adb, ['-s', device, 'shell', 'rm', flag]);
          emit({ type: 'log', message: `Pulled ${f.label} from ${device}` });
          emit({ type: 'transferred', path: dest, kind: f.local });
        } else {
          emit({ type: 'log', message: `Failed to pull ${f.label} from ${device}: ${pull.tail.split('\n').pop()}` });
        }
      }
    }
  } catch (e) {
    emit({ type: 'log', message: `ADB error: ${e.message}` });
  } finally {
    busy = false;
  }
}

function start(emitter) {
  emit = emitter;
  if (timer) return status();
  if (!adbPath()) {
    emit({ type: 'log', message: 'adb not found. Install Android platform-tools (macOS: brew install android-platform-tools).' });
    return status();
  }
  timer = setInterval(tick, POLL_MS);
  tick();
  emit({ type: 'log', message: 'Phone transfer started' });
  return status();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  emit({ type: 'log', message: 'Phone transfer stopped' });
  return status();
}

module.exports = { start, stop, status };
