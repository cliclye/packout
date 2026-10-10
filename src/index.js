const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, nativeTheme, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const storage = require('./main/storage');
const importer = require('./main/importer');
const adb = require('./main/adb');
const netApi = require('./main/net');
const ai = require('./main/ai');
const scout = require('./main/scout');
const { findCommand } = require('./main/util');

try {
  // Windows installer launches the app with squirrel flags; exit early for those.
  if (require('electron-squirrel-startup')) app.quit();
} catch {
  /* not on Windows / not installed */
}

// Local files (match videos, pit photos, calibration frames) are served through a
// custom scheme so the renderer never needs file:// access.
protocol.registerSchemesAsPrivileged([
  { scheme: 'packout-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: false } },
]);

const MEDIA_EXTS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.png', '.jpg', '.jpeg']);

// Dev-only: PACKOUT_DEBUG_PORT=9333 npm start lets test scripts drive the window over CDP.
if (!app.isPackaged && process.env.PACKOUT_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.PACKOUT_DEBUG_PORT);

let mainWindow = null;

const send = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
};

function createWindow() {
  const settings = storage.getSettings();
  nativeTheme.themeSource = ['light', 'dark'].includes(settings.theme) ? settings.theme : 'system';

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0e13' : '#f5f6f8',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    let same = false;
    try {
      same = new URL(url).origin === new URL(MAIN_WINDOW_WEBPACK_ENTRY).origin;
    } catch {
      /* malformed -> block */
    }
    if (!same) e.preventDefault();
  });
  mainWindow.on('closed', () => (mainWindow = null));
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
}

app.whenReady().then(() => {
  protocol.handle('packout-media', async (request) => {
    try {
      const url = new URL(request.url);
      const file = decodeURIComponent(url.pathname.replace(/^\//, ''));
      if (!MEDIA_EXTS.has(path.extname(file).toLowerCase()) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
      // net.fetch on a file:// URL honours Range headers, so <video> seeking works.
      return net.fetch(pathToFileURL(file).toString(), { headers: request.headers });
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });

  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: packout-media:; media-src 'self' blob: packout-media:; connect-src 'self'; font-src 'self' data:",
          ],
        },
      });
    });
  }

  ai.setEmitter((payload) => send('ai:event', payload));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  adb.stop();
  if (process.platform !== 'darwin') app.quit();
});

// ------------------------------------------------------------------- IPC ----

/** Every handler resolves to {ok,data} / {ok:false,error} so errors reach the UI with clean messages. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      console.error(`[${channel}]`, e);
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });
}

handle('settings:get', () => storage.getSettings());
handle('settings:set', (patch) => {
  const next = storage.setSettings(patch || {});
  if (patch && patch.theme) nativeTheme.themeSource = ['light', 'dark'].includes(patch.theme) ? patch.theme : 'system';
  return next;
});
handle('workspace:load', () => storage.loadWorkspace());
handle('workspace:save', (data) => storage.saveWorkspace(data));

handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
handle('dialog:video', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});
handle('dialog:open', async (filters, title) => {
  const r = await dialog.showOpenDialog(mainWindow, { title, properties: ['openFile'], filters });
  return r.canceled ? null : r.filePaths[0];
});
handle('dialog:save', async ({ content, defaultPath, filters }) => {
  const r = await dialog.showSaveDialog(mainWindow, { defaultPath, filters });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, content, 'utf8');
  return r.filePath;
});
handle('fs:read-text', (file) => {
  const st = fs.statSync(file);
  if (st.size > 256 * 1024 * 1024) throw new Error('File is too large.');
  return fs.readFileSync(file, 'utf8');
});
handle('shell:reveal', (file) => shell.showItemInFolder(file));
handle('shell:open-external', (url) => {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only web links can be opened.');
  return shell.openExternal(url);
});

handle('sync:default-folders', () => importer.defaultFolders());
handle('sync:import-path', (target) => importer.importPath(target));

handle('adb:status', () => adb.status());
handle('adb:start', () => adb.start((ev) => send('adb:event', ev)));
handle('adb:stop', () => adb.stop());

handle('tba:fetch', (endpoint, key) => netApi.fetchBlueAlliance(endpoint, key || storage.getSettings().tbaApiKey));
handle('llm:chat', (req) => {
  const s = storage.getSettings();
  const provider = s.llmProvider === 'anthropic' ? 'anthropic' : 'openai';
  return netApi.chat({
    provider,
    apiKey: s.llmApiKey,
    model: provider === 'anthropic' ? s.anthropicModel : s.openaiModel,
    system: req.system,
    messages: req.messages,
  });
});

handle('tools:status', async () => {
  const status = await ai.toolStatus();
  return { ...status, adb: findCommand(['adb']) };
});

handle('video:download', ({ url, matchNumber, jobId }) => ai.downloadMatchVideo({ url, matchNumber, jobId }));

handle('ai:setup', () => ai.setupEnvironment());
handle('ai:cancel', () => ai.cancel());
handle('ai:runs', () => ai.listRuns());
handle('ai:run', (id) => ai.getRun(id));
handle('ai:create', (p) => ai.createRun(p));
handle('ai:update', (id, patch) => ai.updateRun(id, patch));
handle('ai:delete', (id) => ai.deleteRun(id));
handle('ai:import-detections', (p) => ai.importDetections(p));
handle('ai:set-cover', (id, dataUrl) => ai.setCover(id, dataUrl));
handle('ai:download', (id) => ai.downloadForRun(id));
handle('ai:detect', (id) => ai.detect(id));
handle('ai:track', (id, params) => ai.trackRun(id, params));
handle('ai:save-csv', (p) => ai.saveCsv(p));
handle('ai:default-calibration', () => scout.DEFAULT_CALIBRATION);

handle('schedule:bundled', () => {
  const candidates = [
    path.join(app.getAppPath(), 'src', 'resources', 'schedule.txt'),
    path.join(process.resourcesPath || '', 'resources', 'schedule.txt'),
    path.join(process.resourcesPath || '', 'schedule.txt'),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const matches = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const name = lines[i];
    const parts = lines[i + 1].split('\t').map((p) => p.trim());
    if (parts.length >= 6) {
      matches.push({
        matchNumber: parseInt(name.replace(/\D/g, '') || '0', 10),
        name,
        redTeams: parts.slice(0, 3),
        blueTeams: parts.slice(3, 6),
        timeLabel: parts.slice(6).join(' '),
      });
    }
  }
  return matches;
});
