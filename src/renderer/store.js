import { useSyncExternalStore } from 'react';
import { api } from './api';
import * as M from '../shared/models';
import { summarize } from '../shared/analytics';
import { sampleMatches, samplePits, samplePaths } from '../shared/sample';

/**
 * App state: a list of competitions (each an isolated workspace) plus UI state.
 * Persisted by the main process to userData/workspace.json (not localStorage, so
 * large path datasets never hit browser quotas).
 */

const WORKSPACE_VERSION = 2;

const emptyPicklist = () => ({
  picked: [],
  dnp: [],
  alliance: { captain: null, pick1: null, pick2: null },
  strategy1: 'scoringBot',
  strategy2: 'defenseBot',
});

const newCompetition = (name, eventKey = '') => ({
  id: 'comp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
  name: name || 'Untitled competition',
  eventKey: eventKey || '',
  createdAt: new Date().toISOString(),
  matches: [],
  pits: [],
  paths: [],
  schedule: [],
  videos: [],
  log: [],
  picklist: emptyPicklist(),
});

let state = {
  ready: false,
  page: 'dashboard',
  competitions: [],
  currentId: null,
  settings: {},
  selectedTeam: null,
  saveState: 'saved', // saved | saving | error
  toasts: [],
};

const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getState = () => state;
function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

// ------------------------------------------------------------ persistence ---

const packRun = (r) => ({
  ...r,
  samples: r.samples.map((s) => [s.isAuto ? 1 : 0, +s.x.toFixed(4), +s.y.toFixed(4), +s.time.toFixed(2)]),
});
const unpackRun = (r) =>
  M.normalizePathRun({
    ...r,
    samples: (r.samples || []).map((s) => (Array.isArray(s) ? { isAuto: s[0] === 1, x: s[1], y: s[2], time: s[3] } : s)),
  });

function serialize() {
  return JSON.stringify({
    version: WORKSPACE_VERSION,
    currentId: state.currentId,
    competitions: state.competitions.map((c) => ({ ...c, paths: c.paths.map(packRun) })),
  });
}

function hydrateCompetition(c) {
  const base = newCompetition(c.name, c.eventKey);
  return {
    ...base,
    ...c,
    matches: (c.matches || []).map(M.normalizeMatch),
    pits: (c.pits || []).map(M.normalizePit),
    // v1 stored one RobotPathFile per team; both shapes load.
    paths: (c.paths || []).map(unpackRun),
    schedule: (c.schedule || []).map(M.normalizeScheduled),
    videos: (c.videos || []).map(M.normalizeVideo),
    log: c.log || c.importLog || [],
    picklist: { ...emptyPicklist(), ...(c.picklist || {}) },
  };
}

let saveTimer = null;
function scheduleSave() {
  if (state.saveState !== 'saving') state = { ...state, saveState: 'saving' };
  emit();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 700);
}

async function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    await api.workspace.save(serialize());
    if (!saveTimer) setState({ saveState: 'saved' });
  } catch (e) {
    console.error('Failed to save workspace', e);
    setState({ saveState: 'error' });
    store.toast('Could not save your data: ' + e.message, 'error');
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (saveTimer) flushSave();
  });
}

// ---------------------------------------------------------------- helpers ---

export const getCurrent = () => state.competitions.find((c) => c.id === state.currentId) || null;

function mutateCurrent(fn, logMessage) {
  const cur = getCurrent();
  if (!cur) {
    store.toast('Create a competition first.', 'warn');
    return false;
  }
  let next = fn(cur);
  if (logMessage) next = { ...next, log: [...next.log, `${new Date().toISOString()}  ${logMessage}`].slice(-300) };
  setState({ competitions: state.competitions.map((c) => (c.id === cur.id ? next : c)) });
  scheduleSave();
  return true;
}

function mergeById(existing, incoming) {
  const map = new Map(existing.map((x) => [x.id, x]));
  for (const x of incoming) map.set(x.id, x);
  return [...map.values()];
}

// ----------------------------------------------------------------- store ----

export const store = {
  async init() {
    let settings = {};
    try {
      settings = await api.settings.get();
    } catch (e) {
      console.error(e);
    }
    let ws = null;
    try {
      ws = await api.workspace.load();
    } catch (e) {
      console.error(e);
    }

    let competitions = [];
    let currentId = null;
    if (ws && Array.isArray(ws.competitions)) {
      competitions = ws.competitions.map(hydrateCompetition);
      currentId = ws.currentId;
    } else {
      // First launch after the update: carry over data from the old localStorage store.
      try {
        const legacy = JSON.parse(localStorage.getItem('packout_competitions') || 'null');
        if (Array.isArray(legacy) && legacy.length) {
          competitions = legacy.map((c) => hydrateCompetition({ ...c, paths: [] }));
          currentId = localStorage.getItem('packout_current_competition') || null;
        }
      } catch {
        /* ignore */
      }
    }
    if (!competitions.find((c) => c.id === currentId)) currentId = competitions[0]?.id || null;
    setState({ ready: true, competitions, currentId, settings });
    applyTheme(settings.theme);
  },

  // -- navigation / selection
  go(page) {
    setState({ page });
  },
  setSelectedTeam(team) {
    setState({ selectedTeam: team });
  },

  // -- settings
  async updateSettings(patch) {
    const next = await api.settings.set(patch);
    setState({ settings: next });
    if (patch.theme !== undefined) applyTheme(next.theme);
    return next;
  },

  // -- toasts
  toast(message, kind = 'info') {
    const id = Math.random().toString(36).slice(2);
    setState({ toasts: [...state.toasts, { id, kind, message }] });
    setTimeout(() => setState({ toasts: state.toasts.filter((t) => t.id !== id) }), kind === 'error' ? 7000 : 3800);
  },
  dismissToast(id) {
    setState({ toasts: state.toasts.filter((t) => t.id !== id) });
  },

  // -- competitions
  createCompetition(name, eventKey) {
    const comp = newCompetition(name, eventKey);
    comp.log.push(`${new Date().toISOString()}  Created competition ${comp.name}`);
    setState({ competitions: [...state.competitions, comp], currentId: comp.id });
    scheduleSave();
    return comp;
  },
  switchCompetition(id) {
    if (state.competitions.some((c) => c.id === id)) {
      setState({ currentId: id, selectedTeam: null });
      scheduleSave();
    }
  },
  updateCompetition(patch) {
    mutateCurrent((c) => ({ ...c, ...patch }));
  },
  deleteCompetition(id) {
    const competitions = state.competitions.filter((c) => c.id !== id);
    const currentId = state.currentId === id ? competitions[0]?.id || null : state.currentId;
    setState({ competitions, currentId, selectedTeam: null });
    scheduleSave();
  },

  // -- data import
  importResults(results, label = 'import') {
    const r = {
      matchRecords: results.matchRecords || [],
      pitRecords: results.pitRecords || [],
      pathRuns: results.pathRuns || [],
      videos: results.videos || [],
    };
    const total = r.matchRecords.length + r.pitRecords.length + r.pathRuns.length + r.videos.length;
    if (!total) return 0;
    mutateCurrent(
      (c) => ({
        ...c,
        matches: mergeById(c.matches, r.matchRecords.map(M.normalizeMatch)),
        pits: mergeById(c.pits, r.pitRecords.map(M.normalizePit)),
        paths: mergeById(c.paths, r.pathRuns.map(M.normalizePathRun)),
        videos: mergeById(c.videos, r.videos.map(M.normalizeVideo)),
      }),
      `Imported ${r.matchRecords.length} match, ${r.pitRecords.length} pit, ${r.pathRuns.length} path, ${r.videos.length} video record(s) from ${label}`
    );
    return total;
  },
  addPathRuns(runs, message) {
    mutateCurrent((c) => ({ ...c, paths: mergeById(c.paths, runs.map(M.normalizePathRun)) }), message || `Added ${runs.length} path(s)`);
  },
  removePathRuns(ids) {
    const drop = new Set(ids);
    mutateCurrent((c) => ({ ...c, paths: c.paths.filter((p) => !drop.has(p.id)) }), `Removed ${ids.length} path(s)`);
  },
  replaceSchedule(schedule, source) {
    mutateCurrent(
      (c) => ({ ...c, schedule: schedule.map(M.normalizeScheduled).sort((a, b) => a.matchNumber - b.matchNumber) }),
      `Loaded ${schedule.length} scheduled matches (${source})`
    );
  },
  setMatchVideo(matchNumber, url) {
    mutateCurrent(
      (c) => ({
        ...c,
        videos: [
          ...c.videos.filter((v) => M.naturalNumber(v.inferredMatchNumber) !== M.naturalNumber(matchNumber)),
          M.normalizeVideo({ id: 'video:' + url, url, inferredMatchNumber: String(matchNumber) }),
        ],
      }),
      `Attached video to match ${matchNumber}`
    );
  },
  removeVideo(id) {
    mutateCurrent((c) => ({ ...c, videos: c.videos.filter((v) => v.id !== id) }), 'Removed a video');
  },
  loadSampleData() {
    mutateCurrent(
      (c) => ({
        ...c,
        matches: mergeById(c.matches, sampleMatches()),
        pits: mergeById(c.pits, samplePits()),
        paths: mergeById(c.paths, samplePaths()),
      }),
      'Loaded demo data'
    );
  },
  clearData(kind) {
    mutateCurrent(
      (c) => {
        if (kind === 'samples') {
          const keep = (x) => !String(x.id).startsWith('sample:');
          return { ...c, matches: c.matches.filter(keep), pits: c.pits.filter(keep), paths: c.paths.filter(keep) };
        }
        if (kind === 'paths') return { ...c, paths: [] };
        return { ...c, matches: [], pits: [], paths: [], videos: [] };
      },
      kind === 'samples' ? 'Removed demo data' : kind === 'paths' ? 'Cleared all paths' : 'Cleared all scouting data'
    );
  },
  appendLog(message) {
    mutateCurrent((c) => c, message);
  },

  // -- picklist
  setPicklist(patch) {
    mutateCurrent((c) => ({ ...c, picklist: { ...c.picklist, ...patch } }));
  },

  // -- backup / restore
  exportCompetitionJson() {
    const c = getCurrent();
    if (!c) return null;
    return JSON.stringify({ app: 'packout', version: WORKSPACE_VERSION, competition: { ...c, paths: c.paths.map(packRun) } });
  },
  importCompetitionJson(text) {
    const data = JSON.parse(text);
    // accepts v2 backups and the old {competition, data:{...}} shape
    let raw = data.competition;
    if (!raw) throw new Error('This file is not a Packout competition backup.');
    if (data.data) raw = { ...raw, ...data.data };
    const comp = hydrateCompetition({ ...raw, id: undefined });
    comp.id = newCompetition().id;
    comp.name = `${raw.name || 'Imported'} (imported)`;
    comp.log.push(`${new Date().toISOString()}  Restored from backup`);
    setState({ competitions: [...state.competitions, comp], currentId: comp.id });
    scheduleSave();
    return comp;
  },
};

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

// ------------------------------------------------------------------ hooks ---

export function useApp() {
  return useSyncExternalStore(subscribe, getState);
}

export function useCurrent() {
  const s = useApp();
  return s.competitions.find((c) => c.id === s.currentId) || null;
}

let summaryCache = { m: null, p: null, pa: null, value: [] };
export function getSummaries(comp) {
  if (!comp) return [];
  if (summaryCache.m === comp.matches && summaryCache.p === comp.pits && summaryCache.pa === comp.paths) return summaryCache.value;
  summaryCache = { m: comp.matches, p: comp.pits, pa: comp.paths, value: summarize(comp.matches, comp.pits, comp.paths) };
  return summaryCache.value;
}

export function useSummaries() {
  return getSummaries(useCurrent());
}

// Dev server only: handy for test scripts and the console.
if (typeof window !== 'undefined' && window.location.protocol === 'http:') window.__store = store;
