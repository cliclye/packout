const { app, net } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ai = require('./ai');
const toolpaths = require('./toolpaths');
const { isWin, isMac, findCommand, capture, runProcess, ensureDir } = require('./util');

/**
 * One-button installer for everything Packout can use: adb, Python 3.12, yt-dlp, ffmpeg and the AI
 * packages. Everything goes into userData/tools (no admin rights, no Homebrew, nothing system-wide).
 */

const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

async function download(url, dest, onPercent) {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'Packout-Desktop' } });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}) — ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let got = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    got += value.length;
    if (total && onPercent && Date.now() - last > 250) { last = Date.now(); onPercent(Math.round((got / total) * 100)); }
  }
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
}

/** bsdtar ships with macOS and Windows 10+, and reads both .zip and .tar.gz. */
async function extract(archive, dir) {
  ensureDir(dir);
  const r = await capture(isWin ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar', ['-xf', archive, '-C', dir]);
  if (r.code !== 0) throw new Error('Could not unpack the download. ' + r.tail);
}

function findFile(dir, names) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const f = findFile(p, names);
      if (f) return f;
    } else if (names.includes(e.name)) return p;
  }
  return null;
}

const tmpFile = (name) => path.join(ensureDir(path.join(os.tmpdir(), 'packout-tools')), name);

// ----------------------------------------------------------------- steps ---

async function installAdb(ctx) {
  const url = `https://dl.google.com/android/repository/platform-tools-latest-${isWin ? 'windows' : 'darwin'}.zip`;
  const file = tmpFile('platform-tools.zip');
  ctx.say('Downloading Android platform-tools…');
  await download(url, file, ctx.percent);
  fs.rmSync(toolpaths.platformTools(), { recursive: true, force: true });
  await extract(file, toolpaths.root());
  fs.rmSync(file, { force: true });
  if (!findCommand(['adb'])) throw new Error('adb was not found after unpacking.');
}

async function installPython(ctx) {
  const target = isWin ? `uv-${arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc.zip` : `uv-${arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin.tar.gz`;
  const file = tmpFile(target);
  ctx.say('Downloading the Python installer (uv)…');
  await download(`https://github.com/astral-sh/uv/releases/latest/download/${target}`, file, ctx.percent);
  fs.rmSync(toolpaths.uvDir(), { recursive: true, force: true });
  await extract(file, toolpaths.uvDir());
  fs.rmSync(file, { force: true });
  const uv = findFile(toolpaths.uvDir(), [isWin ? 'uv.exe' : 'uv']);
  if (!uv) throw new Error('Could not find uv after unpacking.');
  if (!isWin) fs.chmodSync(uv, 0o755);
  ctx.say('Installing Python 3.12 (about 30 MB)…');
  const r = await runProcess(uv, ['python', 'install', '3.12'], {
    env: { ...process.env, UV_PYTHON_INSTALL_DIR: toolpaths.pyDir(), UV_PYTHON_INSTALL_BIN: '0', UV_PYTHON_INSTALL_REGISTRY: '0', UV_PYTHON_PREFERENCE: 'only-managed' },
    onLine: ctx.say,
  });
  if (r.code !== 0) throw new Error('Python install failed.\n' + r.tail);
  if (!toolpaths.managedPython()) throw new Error('Python was installed but could not be located.');
}

async function installFfmpeg(ctx) {
  const py = await ai.findPython();
  if (!py.path) throw new Error('Needs Python first.');
  // ensureYtDlp creates the private venv we also use for this.
  await ai.ensureYtDlp({ onLog: ctx.say });
  const venvPy = path.join(ai.ytVenv(), isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');
  if (!fs.existsSync(venvPy)) throw new Error('The helper environment could not be created.');
  ctx.say('Downloading ffmpeg…');
  const pip = await runProcess(venvPy, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', 'imageio-ffmpeg'], { onLine: ctx.say });
  if (pip.code !== 0) throw new Error('ffmpeg download failed.\n' + pip.tail);
  const q = await capture(venvPy, ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']);
  const exe = (q.stdout || '').trim().split('\n').pop();
  if (!exe || !fs.existsSync(exe)) throw new Error('ffmpeg was downloaded but could not be located.');
  const dest = path.join(ensureDir(toolpaths.binDir()), isWin ? 'ffmpeg.exe' : 'ffmpeg');
  fs.copyFileSync(exe, dest);
  if (!isWin) fs.chmodSync(dest, 0o755);
}

const STEPS = [
  { id: 'adb', label: 'Android platform-tools (adb)', have: async () => Boolean(findCommand(['adb'])), run: installAdb },
  { id: 'python', label: 'Python 3.12', have: async () => (await ai.findPython()).ok, run: installPython },
  { id: 'ytdlp', label: 'yt-dlp (video downloads)', needs: 'python', have: async () => fs.existsSync(ai.ytBin()) || Boolean(findCommand(['yt-dlp', 'yt-dlp_macos'])), run: (ctx) => ai.ensureYtDlp({ force: true, onLog: ctx.say }) },
  { id: 'ffmpeg', label: 'ffmpeg (video merging)', needs: 'python', have: async () => Boolean(findCommand(['ffmpeg'])), run: installFfmpeg },
  { id: 'ai', label: 'AI detector packages', needs: 'python', have: async () => (await ai.toolStatus()).env.ready, run: (ctx) => ai.setupEnvironment(ctx.say) },
];

/**
 * Installs whatever is missing. `only` limits it to some step ids; `force` reinstalls even if present.
 * Steps never abort each other, except those that need Python when Python could not be installed.
 */
async function installAll({ only, force = false } = {}, emit = () => {}) {
  const results = {};
  const failed = new Set();
  for (const step of STEPS) {
    if (only && !only.includes(step.id)) continue;
    const send = (status, message) => emit({ type: 'step', id: step.id, label: step.label, status, message });
    if (step.needs && failed.has(step.needs)) {
      results[step.id] = 'skipped';
      send('error', `Skipped — ${step.needs} is not available.`);
      continue;
    }
    if (!force && (await step.have().catch(() => false))) {
      results[step.id] = 'present';
      send('done', 'Already installed');
      continue;
    }
    send('running', 'Starting…');
    const ctx = { say: (m) => m && send('running', String(m).slice(0, 160)), percent: (p) => send('running', `Downloading… ${p}%`) };
    try {
      await step.run(ctx);
      results[step.id] = 'installed';
      send('done', 'Installed');
    } catch (e) {
      failed.add(step.id);
      results[step.id] = 'failed';
      send('error', String(e.message || e).split('\n').slice(0, 3).join(' '));
    }
  }
  return results;
}

module.exports = { installAll, STEPS };
