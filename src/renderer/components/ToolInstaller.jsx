import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { store } from '../store';
import { Button, Icon, Spinner } from './ui';

const ORDER = ['adb', 'python', 'ytdlp', 'ffmpeg', 'ai'];

/** "Install everything that's missing" with live progress. `missing` is true when any tool is absent. */
export default function ToolInstaller({ missing, onDone, label = 'Install missing tools' }) {
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState({});

  useEffect(() => api.tools.onEvent((ev) => {
    if (ev.type === 'step') setSteps((s) => ({ ...s, [ev.id]: ev }));
  }), []);

  const go = async () => {
    setSteps({});
    setBusy(true);
    try {
      const res = await api.tools.installAll({});
      const bad = Object.values(res).filter((r) => r === 'failed').length;
      store.toast(bad ? 'Some tools could not be installed — see the list.' : 'Everything is installed', bad ? 'warn' : 'success');
    } catch (e) {
      store.toast(e.message, 'error');
    } finally {
      setBusy(false);
      if (onDone) onDone();
    }
  };

  const shown = ORDER.filter((id) => steps[id]);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {(missing || busy) && <div><Button variant="primary" icon="download" loading={busy} onClick={go}>{busy ? 'Installing…' : label}</Button> <small className="muted">Downloads about 1 GB in total, no admin password needed. Nothing is installed outside Packout’s own folder.</small></div>}
      {shown.length > 0 && (
        <div>
          {shown.map((id) => {
            const s = steps[id];
            return (
              <div className="tool-row" key={id}>
                <div><strong>{s.label}</strong><small>{s.message}</small></div>
                <span className={`tool-state ${s.status === 'done' ? 'ok' : s.status === 'error' ? 'bad' : ''}`}>
                  {s.status === 'running' ? <Spinner /> : <Icon name={s.status === 'done' ? 'check' : 'alert'} size={15} />}
                  {s.status === 'running' ? 'Working' : s.status === 'done' ? 'Done' : 'Failed'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
