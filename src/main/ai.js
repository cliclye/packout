const fs = require('fs');
const path = require('path');
const { app, net } = require('electron');
const { isWin, richEnv, findCommand, runProcess, capture, ensureDir, writeFileAtomic } = require('./util');
const { getSettings } = require('./storage');
const scout = require('./scout');

/**
 * Video → robot paths, using the same stages as scouting-ai:
 *   1. yt-dlp downloads the match video
 *   2. detector.py (Roboflow InferencePipeline) writes per-frame detections
 *   3. scout.js (port of AIScout) turns detections into per-team paths
 *
 * Each match lives in its own "run" folder under userData/ai/runs so work can
 * be resumed (e.g. re-track with a better field calibration) without redoing
 * the slow download/detection stages.
 */

const aiRoot = () => ensureDir(path.join(app.getPath('userData'), 'ai'));
const runsRoot = () => ensureDir(path.join(aiRoot(), 'runs'));
const runDir = (id) => path.join(runsRoot(), id);
const dataDir = () => ensureDir(path.join(aiRoot(), 'data'));
const venvDir = () => path.join(aiRoot(), 'venv');
const venvPython = () => path.join(venvDir(), isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');

function resourcePath(...rel) {
  const candidates = [
    path.join(app.getAppPath(), 'src', 'resources', ...rel),
    path.join(process.resourcesPath || '', 'resources', ...rel),
    path.join(process.resourcesPath || '', ...rel),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

// ---------------------------------------------------------------- tooling ---

let emitFn = () => {};
const setEmitter = (fn) => (emitFn = fn);
const emit = (payload) => emitFn(payload);

let current = null; // { child, cancelled }

function track(child) {
  current = { child, cancelled: false };
}
function cancel() {
  if (!current) return false;
  current.cancelled = true;
  try {
    current.child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
  return true;
}
const wasCancelled = () => Boolean(current && current.cancelled);

async function pythonVersion(cmd, preArgs = []) {
  try {
    const res = await capture(cmd, [...preArgs, '--version']);
    const m = /Python (\d+)\.(\d+)\.(\d+)/.exec(res.stdout || res.tail);
    return m ? { major: +m[1], minor: +m[2], text: m[0].replace('Python ', '') } : null;
  } catch {
    return null;
  }
}

/** Finds a Python the AI stack supports (3.9–3.12, same limit as scouting-ai). */
async function findPython() {
  const setting = getSettings().pythonPath;
  const candidates = [];
  if (setting) candidates.push({ cmd: setting, pre: [] });
  for (const n of ['python3.12', 'python3.11', 'python3.10', 'python3.9']) {
    const p = findCommand([n]);
    if (p) candidates.push({ cmd: p, pre: [] });
  }
  const generic = findCommand(isWin ? ['python', 'py'] : ['python3', 'python']);
  if (generic) candidates.push({ cmd: generic, pre: [] });

  let unsupported = null;
  for (const c of candidates) {
    const v = await pythonVersion(c.cmd, c.pre);
    if (!v) continue;
    if (v.major === 3 && v.minor >= 9 && v.minor <= 12) return { ok: true, path: c.cmd, pre: c.pre, version: v.text };
    unsupported = unsupported || { path: c.cmd, version: v.text };
  }
  return unsupported
    ? { ok: false, path: unsupported.path, version: unsupported.version, message: `Python ${unsupported.version} is not supported — install Python 3.12 (3.9–3.12 required).` }
    : { ok: false, message: 'Python 3 not found. Install Python 3.12 from python.org (macOS: brew install python@3.12).' };
}

async function envMissing() {
  const py = venvPython();
  if (!fs.existsSync(py)) return ['environment'];
  const res = await capture(py, [
    '-c',
    "import importlib.util as u; print(','.join(m for m in ('cv2','supervision','inference') if u.find_spec(m) is None))",
  ]);
  if (res.code !== 0) return ['environment'];
  return res.stdout.split(',').filter(Boolean);
}

async function toolStatus() {
  const [python, missing] = await Promise.all([findPython(), envMissing()]);
  const settings = getSettings();
  return {
    python,
    env: { ready: missing.length === 0, missing },
    ytdlp: findCommand(['yt-dlp', 'yt-dlp_macos']),
    ffmpeg: findCommand(['ffmpeg']),
    roboflowKey: Boolean(settings.roboflowApiKey),
    workDir: aiRoot(),
  };
}

/** Creates a private venv and installs the inference stack (one-time, large download). */
async function setupEnvironment() {
  const py = await findPython();
  if (!py.ok) throw new Error(py.message);
  const log = (message) => emit({ job: 'setup', type: 'log', message });

  if (!fs.existsSync(venvPython())) {
    log(`Creating virtual environment with Python ${py.version}…`);
    const res = await runProcess(py.path, [...py.pre, '-m', 'venv', venvDir()], { onLine: log, onStart: track });
    if (res.code !== 0) throw new Error('Could not create the Python environment.\n' + res.tail);
  }
  const pipArgs = ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off'];
  log('Updating pip…');
  await runProcess(venvPython(), [...pipArgs, '--upgrade', 'pip'], { onLine: log, onStart: track });
  log('Installing inference, supervision and OpenCV — this downloads a few hundred MB and can take several minutes…');
  const res = await runProcess(venvPython(), [...pipArgs, 'inference', 'supervision', 'opencv-python-headless'], {
    onLine: log,
    onStart: track,
  });
  if (wasCancelled()) throw new Error('Cancelled');
  if (res.code !== 0) throw new Error('Package installation failed.\n' + res.tail);
  const missing = await envMissing();
  if (missing.length) throw new Error('Installed, but these modules are still missing: ' + missing.join(', '));
  log('AI environment is ready.');
  return true;
}

// ------------------------------------------------------------------- runs ---

const metaFile = (id) => path.join(runDir(id), 'run.json');

function readRun(id) {
  try {
    return JSON.parse(fs.readFileSync(metaFile(id), 'utf8'));
  } catch {
    return null;
  }
}
function saveRun(run) {
  writeFileAtomic(metaFile(run.id), JSON.stringify(run, null, 2));
  return run;
}

function decorate(run) {
  const dir = runDir(run.id);
  const det = path.join(dir, 'output.json');
  const cover = path.join(dir, 'cover.png');
  return {
    ...run,
    hasDetections: fs.existsSync(det),
    detectionsBytes: fs.existsSync(det) ? fs.statSync(det).size : 0,
    coverPath: fs.existsSync(cover) ? cover : null,
    videoExists: Boolean(run.videoPath && fs.existsSync(run.videoPath)),
  };
}

function listRuns() {
  const out = [];
  for (const name of fs.readdirSync(runsRoot())) {
    const run = readRun(name);
    if (run) out.push(decorate(run));
  }
  return out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function getRun(id) {
  const run = readRun(id);
  if (!run) throw new Error('That analysis no longer exists.');
  return decorate(run);
}

function newId() {
  return 'run_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function createRun({ label, matchNumber, sourceType, source }) {
  const run = {
    id: newId(),
    label: label || '',
    matchNumber: matchNumber || '',
    createdAt: new Date().toISOString(),
    sourceType, // 'url' | 'file'
    source: source || '',
    videoPath: sourceType === 'file' ? source : null,
    tracked: null,
  };
  ensureDir(runDir(run.id));
  return decorate(saveRun(run));
}

function updateRun(id, patch) {
  const run = readRun(id);
  if (!run) throw new Error('That analysis no longer exists.');
  return decorate(saveRun({ ...run, ...patch }));
}

function deleteRun(id) {
  if (!/^run_[a-z0-9]+$/.test(id)) return false;
  fs.rmSync(runDir(id), { recursive: true, force: true });
  return true;
}

/** Adopts a detector output.json (+ optional cover frame / video) produced elsewhere, e.g. by scouting-ai itself. */
function importDetections({ jsonPath, coverPath, videoPath, label, matchNumber }) {
  if (!jsonPath || !fs.existsSync(jsonPath)) throw new Error('Detections file not found.');
  const sample = fs.readFileSync(jsonPath, 'utf8');
  let data;
  try {
    data = JSON.parse(sample);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const first = Array.isArray(data) ? data[0] : null;
  if (!first || first.frame_id === undefined || first.x_min === undefined) {
    throw new Error('That does not look like a detector output.json (expected x_min / frame_id fields).');
  }
  const run = createRun({
    label: label || path.basename(path.dirname(jsonPath)),
    matchNumber,
    sourceType: videoPath ? 'file' : 'detections',
    source: videoPath || jsonPath,
  });
  fs.copyFileSync(jsonPath, path.join(runDir(run.id), 'output.json'));
  if (coverPath && fs.existsSync(coverPath)) fs.copyFileSync(coverPath, path.join(runDir(run.id), 'cover.png'));
  if (videoPath) updateRun(run.id, { videoPath });
  return getRun(run.id);
}

function setCover(id, dataUrl) {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Invalid image data.');
  fs.writeFileSync(path.join(runDir(id), 'cover.png'), Buffer.from(m[2], 'base64'));
  return getRun(id);
}

// --------------------------------------------------------------- download ---

const YT_HINTS = [
  [/sign in to confirm|not a bot|cookies/i, 'YouTube wants a signed-in session. In Settings choose "Use cookies from browser" (e.g. Chrome) and try again.'],
  [/n challenge|javascript runtime|js runtime|deno/i, 'This yt-dlp needs a JavaScript runtime for YouTube. Install Deno (brew install deno) or Node, and keep yt-dlp up to date (yt-dlp -U).'],
  [/unsupported url/i, 'yt-dlp does not recognise that URL.'],
  [/http error 403/i, 'The site refused the download (HTTP 403). Update yt-dlp (yt-dlp -U) or add browser cookies in Settings.'],
];

function describeYtError(tail) {
  for (const [re, hint] of YT_HINTS) if (re.test(tail)) return hint + '\n\n' + tail.split('\n').slice(-3).join('\n');
  return tail.split('\n').slice(-6).join('\n');
}

/** Downloads `url` into `dir` as `<base>.<ext>`; resolves to the file path. */
async function downloadWithYtDlp({ url, dir, base, format, mergeMp4 = true, onProgress, onLog }) {
  const ytdlp = findCommand(['yt-dlp', 'yt-dlp_macos']);
  if (!ytdlp) throw new Error('yt-dlp is not installed. macOS: brew install yt-dlp · Windows: winget install yt-dlp');
  const settings = getSettings();
  ensureDir(dir);
  for (const f of fs.readdirSync(dir)) if (f.startsWith(base + '.')) fs.rmSync(path.join(dir, f), { force: true });

  const args = ['--no-playlist', '--newline', '--no-warnings', '--no-update', '-f', format, '-o', path.join(dir, `${base}.%(ext)s`)];
  if (mergeMp4 && findCommand(['ffmpeg'])) args.push('--merge-output-format', 'mp4');
  if (settings.ytdlpCookiesFile && fs.existsSync(settings.ytdlpCookiesFile)) args.push('--cookies', settings.ytdlpCookiesFile);
  else if (settings.ytdlpCookiesBrowser) args.push('--cookies-from-browser', settings.ytdlpCookiesBrowser);
  args.push(url);

  const res = await runProcess(ytdlp, args, {
    onStart: track,
    onLine: (line) => {
      const m = /\[download\]\s+([\d.]+)%/.exec(line);
      if (m && onProgress) onProgress(parseFloat(m[1]) / 100);
      else if (onLog) onLog(line);
    },
  });
  if (wasCancelled()) throw new Error('Cancelled');
  if (res.code !== 0) throw new Error('Download failed.\n' + describeYtError(res.tail));
  const file = fs.readdirSync(dir).find((f) => f.startsWith(base + '.') && !f.endsWith('.part') && !f.endsWith('.ytdl'));
  if (!file) throw new Error('Download finished but no video file was found.');
  return path.join(dir, file);
}

/** Plain HTTP(S) download for direct video links when yt-dlp is unavailable. */
async function downloadDirect({ url, dir, base, onProgress }) {
  ensureDir(dir);
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
  const ext = path.extname(new URL(url).pathname) || '.mp4';
  const dest = path.join(dir, base + ext);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    out.write(Buffer.from(value));
    if (total && onProgress) onProgress(got / total);
  }
  await new Promise((r) => out.end(r));
  return dest;
}

const DIRECT_RE = /\.(mp4|mov|m4v|webm|mkv)(\?|$)/i;

async function downloadForRun(id) {
  const run = getRun(id);
  if (run.sourceType !== 'url') throw new Error('This analysis uses a local video file.');
  const dir = runDir(id);
  const progress = (value) => emit({ runId: id, job: 'download', type: 'progress', value });
  const log = (message) => emit({ runId: id, job: 'download', type: 'log', message });
  let file;
  if (findCommand(['yt-dlp', 'yt-dlp_macos'])) {
    // 720p matches what the field calibration / detector model were tuned on.
    file = await downloadWithYtDlp({
      url: run.source,
      dir,
      base: 'video',
      format: 'bv*[height=720][ext=mp4]/bv*[height<=720][ext=mp4]/bv*[height<=720]/b[height<=720]/b',
      onProgress: progress,
      onLog: log,
    });
  } else if (DIRECT_RE.test(run.source)) {
    file = await downloadDirect({ url: run.source, dir, base: 'video', onProgress: progress });
  } else {
    throw new Error('yt-dlp is not installed. macOS: brew install yt-dlp · Windows: winget install yt-dlp');
  }
  return updateRun(id, { videoPath: file });
}

/** Film-review download: keeps audio, stored under userData/DownloadedVideos. */
async function downloadMatchVideo({ url, matchNumber, jobId }) {
  const dir = ensureDir(path.join(app.getPath('userData'), 'DownloadedVideos'));
  const base = `match-${String(matchNumber || 'x').replace(/[^\w-]/g, '')}-${Date.now().toString(36)}`;
  const progress = (value) => emit({ job: 'film', jobId, type: 'progress', value });
  if (findCommand(['yt-dlp', 'yt-dlp_macos'])) {
    return downloadWithYtDlp({
      url,
      dir,
      base,
      format: 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]/b',
      onProgress: progress,
    });
  }
  if (DIRECT_RE.test(url)) return downloadDirect({ url, dir, base, onProgress: progress });
  throw new Error('yt-dlp is not installed. macOS: brew install yt-dlp · Windows: winget install yt-dlp');
}

// ---------------------------------------------------------------- detect ----

async function detect(id) {
  const run = getRun(id);
  if (!run.videoExists) throw new Error('Download or choose a video first.');
  const settings = getSettings();
  if (!settings.roboflowApiKey) throw new Error('Add your Roboflow API key in Settings first.');
  if ((await envMissing()).length) throw new Error('The AI environment is not set up yet. Open AI Setup and install it first.');

  const dir = runDir(id);
  const output = path.join(dir, 'output.json');
  fs.rmSync(output, { force: true });
  const args = [resourcePath('ai', 'detector.py'), '--video', run.videoPath, '--output', output, '--cover', path.join(dir, 'cover.png')];

  const res = await runProcess(venvPython(), args, {
    cwd: dir,
    env: richEnv({ ROBOFLOW_API_KEY: settings.roboflowApiKey }),
    onStart: track,
    onLine: (line) => {
      const m = /^PROGRESS (\d+) (\d+)/.exec(line);
      if (m) emit({ runId: id, job: 'detect', type: 'progress', value: Math.min(1, +m[1] / Math.max(1, +m[2])), detail: `${m[1]} / ${m[2]} frames` });
      else if (!/^(DONE|WARNING|INFO)/.test(line) || /^DONE/.test(line)) emit({ runId: id, job: 'detect', type: 'log', message: line });
    },
  });
  if (wasCancelled()) throw new Error('Cancelled');
  if (res.code !== 0 || !fs.existsSync(output)) {
    const msg = res.tail.split('\n').filter((l) => /ERROR|Error|error/.test(l)).pop() || res.tail.split('\n').slice(-4).join('\n');
    throw new Error('Detection failed.\n' + msg);
  }
  return getRun(id);
}

// ---------------------------------------------------------------- tracking --

function loadDetections(id) {
  const file = path.join(runDir(id), 'output.json');
  if (!fs.existsSync(file)) throw new Error('No detections yet — run detection first.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * @param params { teams: string[6], calibration, teleopStart, redOnLeft, manualStarts }
 */
function trackRun(id, params) {
  const { teams, calibration, teleopStart = 0, redOnLeft = true, manualStarts = null } = params;
  const detections = loadDetections(id);
  const { frames, autoFrames } = scout.extractFrames(detections, calibration || scout.DEFAULT_CALIBRATION, Number(teleopStart) || 0);
  try {
    const result = scout.trackRobots(frames, autoFrames, teams, { redOnLeft, manualStarts });
    const autoFrameCount = autoFrames.size;
    updateRun(id, { tracked: { at: new Date().toISOString(), teams, startPercent: result.startPercent, autoStartFound: result.autoStartFound } });
    return { ok: true, ...result, frameCount: frames.length, autoFrameCount };
  } catch (e) {
    if (e.code === 'NO_START_FRAME') {
      return { ok: false, needsManualStart: true, message: e.message, leftShows: e.leftShows, rightShows: e.rightShows, amountShows: e.amountShows, frameCount: frames.length };
    }
    throw e;
  }
}

/** Appends to data/<team>.csv in exactly the format AIScout writes. */
function saveCsv({ robots, dir }) {
  const written = [];
  const target = dir ? ensureDir(dir) : dataDir();
  for (const r of robots) {
    const file = path.join(target, `${String(r.team).replace(/[^\w-]/g, '')}.csv`);
    fs.appendFileSync(file, scout.historyToCsv(r.history));
    written.push(file);
  }
  return written;
}

module.exports = {
  setEmitter, cancel, toolStatus, setupEnvironment,
  listRuns, getRun, createRun, updateRun, deleteRun, importDetections, setCover,
  downloadForRun, downloadMatchVideo, detect, trackRun, saveCsv,
  paths: { aiRoot, dataDir },
};
