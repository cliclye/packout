import { useEffect, useState } from 'react';
import { api } from '../api';

// One shared update state for the sidebar notice and the Settings page.
let state = { info: null, checking: false, error: '', installing: false, stage: '', percent: 0 };
const listeners = new Set();
const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((f) => f(state)); };

export function useUpdates() {
  const [s, setS] = useState(state);
  useEffect(() => { listeners.add(setS); setS(state); return () => listeners.delete(setS); }, []);
  return s;
}

export async function checkForUpdates({ force = false, silent = true } = {}) {
  if (state.checking || state.installing) return state.info;
  set({ checking: true, error: '' });
  try {
    const info = await api.update.check({ force });
    set({ info, checking: false });
    return info;
  } catch (e) {
    set({ checking: false, error: silent ? '' : e.message });
    return null;
  }
}

export async function installUpdate() {
  set({ installing: true, error: '', stage: 'Starting…', percent: 0 });
  const off = api.update.onEvent((ev) => {
    if (ev.type === 'stage') set({ stage: ev.message, percent: ev.message.startsWith('Downloading') ? 0 : 100 });
    if (ev.type === 'progress') set({ percent: ev.percent });
  });
  try {
    await api.update.install(); // the app quits and reopens on the new version
  } catch (e) {
    set({ installing: false, error: e.message });
  } finally {
    off();
  }
}
