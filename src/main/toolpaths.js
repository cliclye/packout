const { app } = require('electron');
const fs = require('fs');
const path = require('path');

/** Where Packout keeps the tools it installs itself (no admin rights, nothing outside userData). */
const isWin = process.platform === 'win32';
const root = () => path.join(app.getPath('userData'), 'tools');
const binDir = () => path.join(root(), 'bin'); // ffmpeg
const platformTools = () => path.join(root(), 'platform-tools'); // adb
const uvDir = () => path.join(root(), 'uv');
const pyDir = () => path.join(root(), 'python');

/** Python 3.12 installed by Packout (via uv), or null. */
function managedPython() {
  try {
    for (const d of fs.readdirSync(pyDir())) {
      if (!d.startsWith('cpython-3.12')) continue;
      const exe = isWin ? path.join(pyDir(), d, 'python.exe') : path.join(pyDir(), d, 'bin', 'python3.12');
      if (fs.existsSync(exe)) return exe;
    }
  } catch {
    /* not installed */
  }
  return null;
}

/** Folders that should be searched for tools Packout installed. Safe to call before the app is ready. */
function extraDirs() {
  try {
    return [binDir(), platformTools()];
  } catch {
    return [];
  }
}

module.exports = { root, binDir, platformTools, uvDir, pyDir, managedPython, extraDirs };
