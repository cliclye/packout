import { api } from '../api';
import { getAppState, getCurrent, getSummaries, store } from '../store';
import { buildField } from '../../shared/deepstats';
import { fitModel } from '../../shared/predict';
import { buildCoachPack } from '../../shared/coachpack';
import { eventMemo, loadEvent } from './tbaLive';

/**
 * Keeps the phone data fresh while sharing is on. Lives outside React so it keeps
 * publishing while you look at other pages of Packout.
 */
const listeners = new Set();
let timer = null;
let st = { running: false, urls: [], key: '', port: 8731, lastAt: null, bytes: 0, error: '', busy: false };
const emit = () => listeners.forEach((l) => l(st));
const set = (patch) => { st = { ...st, ...patch }; emit(); };

export const phoneState = () => st;
export function subscribePhone(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function buildPack({ refreshTba = false } = {}) {
  const comp = getCurrent();
  if (!comp) throw new Error('No competition selected.');
  const settings = getAppState().settings;
  const key = (comp.eventKey || '').trim();
  let event = eventMemo.key === key ? eventMemo.data : null;
  if (settings.tbaApiKey && key && (refreshTba || !event)) {
    try {
      event = await loadEvent(key);
      eventMemo.key = key;
      eventMemo.data = event;
    } catch (e) {
      if (!event) set({ error: `TBA: ${e.message} (sending saved data)` });
    }
  }
  if (!event && comp.tbaSnapshot && comp.tbaSnapshot.info?.key === key) event = comp.tbaSnapshot;
  const summaries = getSummaries(comp);
  const field = buildField(comp.matches, comp.paths, summaries);
  const fit = fitModel(event ? event.matches : [], comp.matches, { tbaOprs: event?.oprs });
  return buildCoachPack({ comp, summaries, field, event, fit, myTeam: (settings.myTeam || '').trim() });
}

export async function publishNow(opts) {
  set({ busy: true });
  try {
    const pack = await buildPack(opts);
    const text = JSON.stringify(pack);
    const s = await api.coach.publish(text);
    set({ lastAt: s.packAt, bytes: s.packBytes, busy: false, error: st.error.startsWith('TBA') ? st.error : '' });
    return pack;
  } catch (e) {
    set({ busy: false, error: e.message });
    throw e;
  }
}

export async function startSharing() {
  const s = await api.coach.start();
  set({ running: true, urls: s.urls, key: s.key, port: s.port, error: '' });
  await publishNow({ refreshTba: true });
  clearInterval(timer);
  timer = setInterval(() => publishNow({ refreshTba: true }).catch(() => {}), 30000);
}

export async function stopSharing() {
  clearInterval(timer);
  timer = null;
  await api.coach.stop();
  set({ running: false });
}

export async function refreshStatus() {
  try {
    const s = await api.coach.status();
    set({ running: s.running, urls: s.urls, key: s.key, port: s.port, lastAt: s.packAt, bytes: s.packBytes });
  } catch {
    /* browser mode */
  }
}

export function setMyTeam(n) {
  return store.updateSettings({ myTeam: n });
}
