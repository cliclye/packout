import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import { Button, Icon, Modal } from './ui';
import { checkForUpdates, installUpdate, useUpdates } from '../lib/updates';

/** Sidebar card shown when a newer release exists on GitHub. */
export default function UpdateNotice() {
  const { settings } = useApp();
  const u = useUpdates();
  const [open, setOpen] = useState(false);
  const auto = settings.autoUpdateCheck !== false;

  useEffect(() => {
    if (!auto) return undefined;
    const t = setTimeout(() => checkForUpdates(), 4000);
    const id = setInterval(() => checkForUpdates({ force: true }), 6 * 60 * 60 * 1000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [auto]);

  const info = u.info;
  if (!info || !info.available) return null;

  return (
    <>
      <button type="button" className="update-card" onClick={() => setOpen(true)}>
        <span className="update-dot"><Icon name="download" size={15} /></span>
        <span className="update-text"><strong>Update available</strong><small>Version {info.latest} is ready</small></span>
      </button>
      {open && (
        <Modal
          title={`Packout ${info.latest} is available`}
          width={520}
          onClose={() => !u.installing && setOpen(false)}
          footer={
            u.installing ? null : (
              <>
                <Button onClick={() => setOpen(false)}>Later</Button>
                {info.canInstall
                  ? <Button variant="primary" icon="download" onClick={installUpdate}>Install update</Button>
                  : <Button variant="primary" icon="external" onClick={() => api.shell.openExternal(info.page)}>Open download page</Button>}
              </>
            )
          }
        >
          <p className="muted">You have {info.current}. {info.canInstall ? 'Packout will download the update, restart, and open the new version.' : 'This copy can’t update itself, so download the installer from the release page.'} <strong>Your competitions, scouting data and settings are kept.</strong></p>
          {u.installing && (
            <div style={{ marginTop: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>{u.stage}</span><span className="muted">{u.percent}%</span></div>
              <div className="progress"><div style={{ width: `${u.percent}%` }} /></div>
            </div>
          )}
          {u.error && <div className="notice error" style={{ marginTop: 14 }}>{u.error}</div>}
          {info.notes && !u.installing && <pre className="update-notes">{info.notes.slice(0, 1500)}</pre>}
        </Modal>
      )}
    </>
  );
}
