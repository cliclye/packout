const path = require('path');
const { app } = require('electron');
const { findCommand, capture, ensureDir } = require('./util');

/**
 * Pulls scouting data off Android phones running the Packout scouting app.
 * Some scouting-app versions drop `newDataFlag.txt` next to their JSON files.
 * We use it as an immediate signal when present, but also sync folders when a
 * phone first connects or their files change so missing flags never block a
 * transfer.
 */
const FOLDERS = [
  { remote: '/sdcard/Documents/ScoutingData', local: 'ScoutingData', label: 'match data' },
  { remote: '/sdcard/Documents/PitData', local: 'PitData', label: 'pit data' },
];
const POLL_MS = 2000;

// macOS can deny a packaged app access to ~/Documents. Keep phone transfers in
// Packout's own data directory, which Electron always has permission to write.
function transferDir(folder) {
  return path.join(app.getPath('userData'), 'phone-data', folder.local);
}

let timer = null;
let busy = false;
let devices = [];
let emit = () => {};
const folderSnapshots = new Map();

/** Android's recycle bin leaves `.trashed-*` files that `adb pull` of a folder often fails on. */
function isPullableName(name) {
  const base = String(name || '').replace(/\r/g, '').trim().split('/').pop();
  if (!base || base === '.' || base === '..') return false;
  if (base === 'newDataFlag.txt') return false;
  if (base.startsWith('.')) return false;
  return true;
}

async function listRemoteFiles(adb, device, remote) {
  const script = `test -d "${remote}" || exit 1; for f in "${remote}"/*; do [ -f "$f" ] || continue; name=\${f##*/}; case "$name" in newDataFlag.txt|.*) continue;; esac; stamp=\$(stat -c '%s:%Y' "$f" 2>/dev/null) || continue; printf '%s\\t%s\\n' "$name" "$stamp"; done`;
  const res = await capture(adb, ['-s', device, 'shell', script]);
  if (res.code !== 0) {
    return { ok: false, files: [], error: res.tail.split('\n').pop() || 'failed to list remote folder' };
  }
  return {
    ok: true,
    files: res.stdout
      .split('\n')
      .map((line) => line.replace(/\r/g, '').trim().split('\t'))
      .filter(([name, stamp]) => isPullableName(name) && Boolean(stamp))
      .map(([name, stamp]) => ({ name, stamp })),
  };
}

async function pullFolder(adb, device, folder, names) {
  const dest = ensureDir(transferDir(folder));
  for (const name of names) {
    const pull = await capture(adb, ['-s', device, 'pull', `${folder.remote}/${name}`, dest]);
    if (pull.code !== 0) {
      return { ok: false, error: pull.tail.split('\n').pop() || 'adb pull failed' };
    }
  }
  return { ok: true };
}

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
      for (const key of folderSnapshots.keys()) {
        if (!found.some((device) => key.startsWith(`${device}:`))) folderSnapshots.delete(key);
      }
      emit({ type: 'devices', devices });
      emit({ type: 'log', message: found.length ? `Connected: ${found.join(', ')}` : 'No devices connected' });
    }
    for (const device of found) {
      for (const f of FOLDERS) {
        const flag = `${f.remote}/newDataFlag.txt`;
        const listed = await listRemoteFiles(adb, device, f.remote);
        if (!listed.ok) {
          emit({ type: 'log', message: `Failed to inspect ${f.label} from ${device}: ${listed.error}` });
          continue;
        }
        const files = listed.files.sort((a, b) => a.name.localeCompare(b.name));
        const snapshotKey = `${device}:${f.remote}`;
        const snapshot = files.map(({ name, stamp }) => `${name}:${stamp}`).join('\u0000');
        const has = await capture(adb, ['-s', device, 'shell', 'test', '-f', flag]);
        if (has.code !== 0 && folderSnapshots.get(snapshotKey) === snapshot) continue;
        const dest = ensureDir(transferDir(f));
        const pull = await pullFolder(adb, device, f, files.map(({ name }) => name));
        if (pull.ok) {
          folderSnapshots.set(snapshotKey, snapshot);
          if (has.code === 0) await capture(adb, ['-s', device, 'shell', 'rm', flag]);
          emit({ type: 'log', message: `Pulled ${f.label} from ${device}` });
          emit({ type: 'transferred', path: dest, kind: f.local });
        } else {
          emit({ type: 'log', message: `Failed to pull ${f.label} from ${device}: ${pull.error}` });
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
