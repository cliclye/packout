const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

/**
 * Apps launched from Finder/Explorer don't inherit the shell PATH, so tools
 * installed with Homebrew, pip --user or the Android SDK are invisible. Add the
 * usual install locations.
 */
function extraPathDirs() {
  const home = os.homedir();
  if (isWin) {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      path.join(local, 'Android', 'Sdk', 'platform-tools'),
      path.join(local, 'Programs', 'Python', 'Python312'),
      path.join(local, 'Programs', 'Python', 'Python312', 'Scripts'),
      path.join(home, 'scoop', 'shims'),
      'C:\\Program Files\\Eclipse Adoptium\\jre\\bin',
    ];
  }
  return [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, 'Library', 'Android', 'sdk', 'platform-tools'),
    path.join(home, 'Android', 'Sdk', 'platform-tools'),
  ];
}

function richEnv(extra = {}) {
  const sep = isWin ? ';' : ':';
  const current = (process.env.PATH || '').split(sep).filter(Boolean);
  const merged = [...current];
  for (const d of extraPathDirs()) if (!merged.includes(d)) merged.push(d);
  return { ...process.env, PATH: merged.join(sep), PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', ...extra };
}

function isExecutable(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return false;
    if (isWin) return true;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Finds the first executable called one of `names` on the augmented PATH. */
function findCommand(names, extraCandidates = []) {
  const list = Array.isArray(names) ? names : [names];
  const sep = isWin ? ';' : ':';
  const dirs = (richEnv().PATH || '').split(sep).filter(Boolean);
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : [''];
  for (const c of extraCandidates) if (c && isExecutable(c)) return c;
  for (const name of list) {
    if (path.isAbsolute(name) && isExecutable(name)) return name;
    for (const dir of dirs) {
      for (const ext of exts) {
        const file = path.join(dir, isWin && !name.toLowerCase().endsWith(ext) ? name + ext : name);
        if (isExecutable(file)) return file;
      }
    }
  }
  return null;
}

/**
 * Runs a process without a shell (no quoting/injection issues) and streams its
 * output line by line. Both \n and \r count as line breaks so progress bars
 * (yt-dlp, tqdm) come through as individual updates.
 */
function runProcess(cmd, args, opts = {}) {
  const { cwd, env, onLine, onStart, input } = opts;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: env || richEnv(), windowsHide: true });
    } catch (e) {
      reject(e);
      return;
    }
    if (onStart) onStart(child);
    const tail = [];
    const pending = { out: '', err: '' };
    const push = (kind, chunk) => {
      pending[kind] += chunk.toString('utf8');
      const parts = pending[kind].split(/[\r\n]+/);
      pending[kind] = parts.pop();
      for (const line of parts) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 60) tail.shift();
        if (onLine) onLine(line, kind === 'err' ? 'stderr' : 'stdout');
      }
    };
    child.stdout.on('data', (c) => push('out', c));
    child.stderr.on('data', (c) => push('err', c));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      for (const kind of ['out', 'err']) {
        if (pending[kind].trim()) {
          tail.push(pending[kind]);
          if (onLine) onLine(pending[kind], kind === 'err' ? 'stderr' : 'stdout');
        }
      }
      resolve({ code, signal, tail: tail.join('\n') });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

/** Run to completion, capture stdout (small outputs only). */
async function capture(cmd, args, opts = {}) {
  let out = '';
  const res = await runProcess(cmd, args, { ...opts, onLine: (l) => (out += l + '\n') });
  return { ...res, stdout: out.trim() };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Writes atomically (tmp file + rename) so a crash never leaves a half-written file. */
function writeFileAtomic(file, data, mode) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

module.exports = {
  isWin, isMac, richEnv, findCommand, runProcess, capture, ensureDir, writeFileAtomic, isExecutable,
};
