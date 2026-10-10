const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Handlers resolve to {ok,data} | {ok:false,error}; unwrap so callers get plain
// values and readable Error messages.
const call = async (channel, ...args) => {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || res.ok === false) throw new Error((res && res.error) || 'Unknown error');
  return res.data;
};

const subscribe = (channel) => (cb) => {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('packout', {
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch),
  },
  workspace: {
    load: () => call('workspace:load'),
    save: (data) => call('workspace:save', data),
  },
  dialog: {
    folders: () => call('dialog:folder'),
    video: () => call('dialog:video'),
    open: (filters, title) => call('dialog:open', filters, title),
    save: (opts) => call('dialog:save', opts),
  },
  fs: { readText: (file) => call('fs:read-text', file) },
  files: { pathFor: (file) => webUtils.getPathForFile(file) },
  shell: {
    reveal: (file) => call('shell:reveal', file),
    openExternal: (url) => call('shell:open-external', url),
  },
  sync: {
    defaultFolders: () => call('sync:default-folders'),
    importPath: (target) => call('sync:import-path', target),
    bundledSchedule: () => call('schedule:bundled'),
  },
  adb: {
    status: () => call('adb:status'),
    start: () => call('adb:start'),
    stop: () => call('adb:stop'),
    onEvent: subscribe('adb:event'),
  },
  tba: { fetch: (endpoint, key) => call('tba:fetch', endpoint, key) },
  llm: { chat: (req) => call('llm:chat', req) },
  tools: { status: () => call('tools:status'), updateYtDlp: () => call('tools:update-ytdlp') },
  video: { download: (req) => call('video:download', req) },
  ai: {
    setup: () => call('ai:setup'),
    cancel: () => call('ai:cancel'),
    runs: () => call('ai:runs'),
    run: (id) => call('ai:run', id),
    create: (p) => call('ai:create', p),
    update: (id, patch) => call('ai:update', id, patch),
    remove: (id) => call('ai:delete', id),
    importDetections: (p) => call('ai:import-detections', p),
    setCover: (id, dataUrl) => call('ai:set-cover', id, dataUrl),
    download: (id) => call('ai:download', id),
    detect: (id) => call('ai:detect', id),
    track: (id, params) => call('ai:track', id, params),
    saveCsv: (p) => call('ai:save-csv', p),
    defaultCalibration: () => call('ai:default-calibration'),
    onEvent: subscribe('ai:event'),
  },
});
