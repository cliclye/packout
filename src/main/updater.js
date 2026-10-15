const { app, net } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const { writeFileAtomic } = require('./util');

const run = promisify(execFile);
const REPO = 'cliclye/packout';
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

let emit = () => {};
let cached = null; // { at, info }
let installing = false;

const setEmitter = (fn) => { emit = fn; };

const parts = (v) => String(v).replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
function isNewer(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

/** The running app bundle (macOS) such as /Applications/Packout.app, or null when it can't be found. */
function macBundle() {
  const b = path.resolve(process.execPath, '..', '..', '..');
  return b.endsWith('.app') ? b : null;
}

function pickAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  if (isMac) {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    return list.find((a) => /darwin/i.test(a.name) && a.name.includes(arch) && /\.zip$/i.test(a.name)) || null;
  }
  if (isWin) return list.find((a) => /setup\.exe$/i.test(a.name)) || null;
  return null;
}

function writable(p) {
  try {
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function canInstallHere() {
  if (!app.isPackaged) return false;
  if (isWin) return true;
  if (isMac) {
    const b = macBundle();
    return Boolean(b && writable(b) && writable(path.dirname(b)));
  }
  return false;
}

/** Looks at the newest published GitHub release. Cached for 10 minutes unless forced. */
async function check({ force = false } = {}) {
  if (!force && cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.info;
  const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': 'Packout-Desktop', Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(res.status === 403 ? 'GitHub is rate-limiting update checks right now. Try again later.' : `Could not check for updates (HTTP ${res.status}).`);
  const rel = await res.json();
  const latest = String(rel.tag_name || '').replace(/^v/i, '');
  const asset = pickAsset(rel.assets);
  const info = {
    current: app.getVersion(),
    latest,
    available: Boolean(latest) && isNewer(latest, app.getVersion()),
    notes: rel.body || '',
    page: rel.html_url,
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null,
    canInstall: Boolean(asset) && canInstallHere(),
    checkedAt: Date.now(),
  };
  cached = { at: Date.now(), info };
  return info;
}

async function download(asset, dest) {
  const res = await net.fetch(asset.url, { headers: { 'User-Agent': 'Packout-Desktop' } });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || asset.size || 0;
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let got = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    got += value.length;
    const now = Date.now();
    if (total && now - last > 150) { last = now; emit({ type: 'progress', percent: Math.min(99, Math.round((got / total) * 100)) }); }
  }
  await new Promise((resolve, reject) => { out.end((e) => (e ? reject(e) : resolve())); });
  if (asset.size && got !== asset.size) throw new Error('The download was incomplete. Please try again.');
}

/**
 * Downloads the newest release and swaps it in. User data lives in the userData folder
 * (workspace.json, settings, AI runs), outside the app, so it is untouched.
 */
async function install() {
  if (installing) throw new Error('An update is already being installed.');
  const info = await check({ force: true });
  if (!info.available) throw new Error('You already have the newest version.');
  if (!info.canInstall) throw new Error('This copy of Packout can’t update itself. Download the new version from the release page.');
  installing = true;
  try {
    const work = path.join(os.tmpdir(), 'packout-update');
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const file = path.join(work, info.asset.name);
    emit({ type: 'stage', message: `Downloading ${info.latest}…` });
    await download(info.asset, file);

    if (isWin) {
      // Squirrel's installer upgrades in place and starts the new version.
      emit({ type: 'stage', message: 'Installing…' });
      spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => app.quit(), 600);
      return { restarting: true };
    }

    // macOS: unpack beside the current app (same volume, so the swap is an atomic rename), then let a
    // small detached script replace the bundle once this process has exited and reopen it.
    const bundle = macBundle();
    const stage = path.join(path.dirname(bundle), `.packout-update-${process.pid}`);
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    emit({ type: 'stage', message: 'Unpacking…' });
    await run('/usr/bin/ditto', ['-x', '-k', file, stage]);
    const fresh = fs.readdirSync(stage).find((n) => n.endsWith('.app'));
    if (!fresh) throw new Error('The update file did not contain an app.');
    const script = path.join(work, 'swap.sh');
    writeFileAtomic(script, [
      '#!/bin/bash',
      'PID="$1"; NEW="$2"; OLD="$3"; STAGE="$4"',
      'for i in $(seq 1 100); do kill -0 "$PID" 2>/dev/null || break; sleep 0.3; done',
      'BACKUP="$OLD.previous"',
      'rm -rf "$BACKUP"',
      'if mv "$OLD" "$BACKUP" && mv "$NEW" "$OLD"; then',
      '  rm -rf "$BACKUP"',
      '  xattr -dr com.apple.quarantine "$OLD" 2>/dev/null',
      'else',
      '  [ -e "$BACKUP" ] && [ ! -e "$OLD" ] && mv "$BACKUP" "$OLD"',
      'fi',
      'rm -rf "$STAGE"',
      'open "$OLD"',
      '',
    ].join('\n'), 0o755);
    emit({ type: 'stage', message: 'Restarting…' });
    const log = fs.openSync(path.join(work, 'swap.log'), 'a');
    spawn('/bin/bash', [script, String(process.pid), path.join(stage, fresh), bundle, stage], { detached: true, stdio: ['ignore', log, log] }).unref();
    setTimeout(() => app.quit(), 400);
    return { restarting: true };
  } catch (e) {
    installing = false;
    throw e;
  }
}

module.exports = { check, install, setEmitter, isNewer };
