const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { ensureDir, writeFileAtomic } = require('./util');

const DEFAULT_SETTINGS = {
  roboflowApiKey: '',
  tbaApiKey: '',
  llmProvider: 'openai',
  llmApiKey: '',
  openaiModel: 'gpt-6-luna',
  anthropicModel: 'claude-haiku-5-5',
  ytdlpCookiesFile: '',
  ytdlpCookiesBrowser: '',
  pythonPath: '',
  theme: 'system',
  onboardingDone: false,
  fieldCalibration: null,
  redOnLeft: true,
};

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const workspaceFile = () => path.join(app.getPath('userData'), 'workspace.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

let settingsCache = null;

function getSettings() {
  if (!settingsCache) settingsCache = { ...DEFAULT_SETTINGS, ...(readJson(settingsFile()) || {}) };
  return settingsCache;
}

function setSettings(patch) {
  settingsCache = { ...getSettings(), ...patch };
  // API keys live here, so keep the file private to the user.
  writeFileAtomic(settingsFile(), JSON.stringify(settingsCache, null, 2), 0o600);
  return settingsCache;
}

function loadWorkspace() {
  const file = workspaceFile();
  return readJson(file) || readJson(file + '.bak');
}

function saveWorkspace(data) {
  const file = workspaceFile();
  ensureDir(path.dirname(file));
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, file + '.bak');
    } catch {
      /* best effort */
    }
  }
  writeFileAtomic(file, typeof data === 'string' ? data : JSON.stringify(data));
  return true;
}

module.exports = { DEFAULT_SETTINGS, getSettings, setSettings, loadWorkspace, saveWorkspace };
