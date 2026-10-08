import { useState, useEffect } from 'react';
import { store } from './store.js';

export function useStore() {
  const [state, setState] = useState(store.getState());
  const [summaries, setSummaries] = useState(store.getTeamSummaries());

  useEffect(() => {
    const unsubscribe = store.subscribe((newState) => {
      setState({ ...newState });
      setSummaries(store.getTeamSummaries());
    });
    return () => unsubscribe();
  }, []);

  return { state, summaries, store };
}

export function useSettings() {
  const [settings, setSettings] = useState(() => {
    return {
      roboflowApiKey: localStorage.getItem('roboflowApiKey') || '',
      tbaEventKey: localStorage.getItem('tbaEventKey') || '',
      tbaApiKey: localStorage.getItem('tbaApiKey') || '',
    };
  });

  const updateSetting = (key, value) => {
    setSettings(prev => {
      const newSettings = { ...prev, [key]: value };
      localStorage.setItem(key, value);
      // Optional IPC sync could be called here if available on window.electron
      if (window.electron && window.electron.ipcRenderer) {
        window.electron.ipcRenderer.send('update-setting', { key, value });
      }
      return newSettings;
    });
  };

  return { settings, updateSetting };
}
