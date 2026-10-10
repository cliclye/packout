/**
 * Thin wrapper over the preload bridge (window.packout). When the UI runs in a
 * plain browser (design previews, tests) a small stand-in keeps the app usable
 * with localStorage persistence; desktop-only features report "not available".
 */
const noDesktop = () => Promise.reject(new Error('This feature needs the Packout desktop app.'));

const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* quota */
    }
  },
};

const browserShim = {
  settings: {
    get: async () => LS.get('packout_settings', {}),
    set: async (patch) => {
      const next = { ...LS.get('packout_settings', {}), ...patch };
      LS.set('packout_settings', next);
      return next;
    },
  },
  workspace: {
    load: async () => LS.get('packout_workspace', null),
    save: async (data) => LS.set('packout_workspace', typeof data === 'string' ? JSON.parse(data) : data),
  },
  dialog: { folders: async () => [], video: noDesktop, open: noDesktop, save: async ({ content, defaultPath }) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content]));
    a.download = (defaultPath || 'export.txt').split(/[/\\]/).pop();
    a.click();
    return defaultPath;
  } },
  fs: { readText: noDesktop },
  files: { pathFor: () => '' },
  shell: { reveal: noDesktop, openExternal: async (url) => window.open(url, '_blank') },
  sync: {
    defaultFolders: async () => [],
    importPath: async () => ({ matchRecords: [], pitRecords: [], pathRuns: [], videos: [], skipped: 0 }),
    bundledSchedule: async () => [],
  },
  adb: {
    status: async () => ({ available: false, running: false, devices: [] }),
    start: noDesktop,
    stop: async () => ({ available: false, running: false, devices: [] }),
    onEvent: () => () => {},
  },
  tba: { fetch: noDesktop },
  llm: { chat: noDesktop },
  tools: { status: async () => ({ python: { ok: false, message: 'Desktop app required' }, env: { ready: false, missing: [] }, ytdlp: null, ffmpeg: null, adb: null, roboflowKey: false }) },
  video: { download: noDesktop },
  ai: new Proxy({ onEvent: () => () => {}, runs: async () => [], defaultCalibration: async () => null }, {
    get: (t, k) => (k in t ? t[k] : noDesktop),
  }),
};

export const hasDesktop = typeof window !== 'undefined' && Boolean(window.packout);
export const api = hasDesktop ? window.packout : browserShim;

/** URL the renderer can load for a local media file (video or image). */
export function mediaUrl(file) {
  if (!file) return '';
  if (!hasDesktop) return '';
  return `packout-media://local/${encodeURIComponent(file)}`;
}
