import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { store, useApp, useCurrent } from '../store';
import { Badge, Button, Card, Field, Icon, LogBox, PageHeader, Stat, Spinner, confirmDialog } from '../components/ui';
import { importPaths } from '../lib/importing';
import { fetchEventSchedule } from '../lib/tba';
import { buildShareText, inspectShare } from '../lib/share';
import { Modal } from '../components/ui';

export default function Sync() {
  const comp = useCurrent();
  const { settings } = useApp();
  const [adb, setAdb] = useState({ available: false, running: false, devices: [] });
  const [adbLog, setAdbLog] = useState([]);
  const [folders, setFolders] = useState([]);
  const [busy, setBusy] = useState('');
  const [over, setOver] = useState(false);
  const [eventKey, setEventKey] = useState(comp.eventKey || '');
  const fileInput = useRef(null);

  const refreshFolders = () => api.sync.defaultFolders().then(setFolders).catch(() => {});
  useEffect(() => {
    refreshFolders();
    api.adb.status().then(setAdb).catch(() => {});
    return api.adb.onEvent((ev) => {
      if (ev.type === 'devices') setAdb((a) => ({ ...a, devices: ev.devices }));
      if (ev.type === 'log') setAdbLog((l) => [`${new Date().toLocaleTimeString()}  ${ev.message}`, ...l].slice(0, 60));
      if (ev.type === 'transferred') refreshFolders();
    });
  }, []);

  const toggleAdb = async () => {
    try {
      const next = adb.running ? await api.adb.stop() : await api.adb.start();
      setAdb(next);
    } catch (e) {
      store.toast(e.message, 'error');
    }
  };

  const doImport = async (paths, label) => {
    setBusy('import');
    try {
      const n = await importPaths(paths, label);
      store.toast(n ? `Imported ${n} new or updated record${n === 1 ? '' : 's'}` : 'No scouting files found there', n ? 'success' : 'warn');
    } catch (e) {
      store.toast(`Import failed: ${e.message}`, 'error');
    } finally {
      setBusy('');
      refreshFolders();
    }
  };

  const chooseFolders = async () => {
    const dirs = await api.dialog.folders().catch(() => []);
    if (dirs.length) doImport(dirs);
  };
  const rescan = () => {
    const existing = folders.filter((f) => f.exists).map((f) => f.path);
    if (!existing.length) return store.toast('None of the default folders exist yet.', 'warn');
    doImport(existing, 'default folders');
  };
  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const paths = [...e.dataTransfer.files].map((f) => api.files.pathFor(f)).filter(Boolean);
    if (paths.length) doImport(paths, 'dropped files');
  };

  const fetchSchedule = async () => {
    setBusy('schedule');
    try {
      if (eventKey.trim() !== comp.eventKey) store.updateCompetition({ eventKey: eventKey.trim() });
      const sched = await fetchEventSchedule(eventKey);
      if (!sched.length) throw new Error('No qualification matches are published for that event yet.');
      store.replaceSchedule(sched, `Blue Alliance ${eventKey.trim()}`);
      store.toast(`Loaded ${sched.length} qualification matches`, 'success');
    } catch (e) {
      store.toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };
  const useBundled = async () => {
    const sched = await api.sync.bundledSchedule().catch(() => []);
    if (!sched.length) return store.toast('No bundled schedule found.', 'warn');
    store.replaceSchedule(sched, 'bundled schedule');
    store.toast(`Loaded ${sched.length} matches from the bundled schedule`, 'success');
  };

  const [incoming, setIncoming] = useState(null); // { text, info } awaiting merge/new choice
  const exportShare = async () => {
    setBusy('share');
    try {
      const content = await buildShareText();
      const file = await api.dialog.save({ content, defaultPath: `${comp.name.replace(/\W+/g, '_')}.packout`, filters: [{ name: 'Packout share file', extensions: ['packout', 'txt', 'json'] }] });
      if (file) store.toast('Share file saved — send it to anyone running Packout', 'success');
    } catch (e) {
      store.toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };
  const importShare = async () => {
    try {
      const file = await api.dialog.open([{ name: 'Packout share file', extensions: ['packout', 'txt', 'json'] }], 'Choose a shared competition file');
      if (!file) return;
      const text = await api.fs.readText(file);
      setIncoming({ text, info: inspectShare(text) });
    } catch (e) {
      store.toast(`Could not read that file: ${e.message}`, 'error');
    }
  };
  const confirmImport = (mode) => {
    try {
      const c = store.importShare(incoming.text, mode);
      store.toast(mode === 'merge' ? `Merged into “${c.name}”` : `Added “${c.name}”`, 'success');
    } catch (e) {
      store.toast(e.message, 'error');
    }
    setIncoming(null);
  };
  const clear = async (kind) => {
    const labels = { samples: 'Remove the demo data?', paths: 'Delete all robot paths?', all: 'Delete all scouting data?' };
    const ok = await confirmDialog({ title: labels[kind], message: kind === 'samples' ? 'Only the built-in demo records are removed.' : 'This removes imported records from this competition. Original files on disk are not touched.', confirmLabel: 'Delete', danger: true });
    if (ok) store.clearData(kind);
  };

  const hasDemo = [...comp.matches, ...comp.pits, ...comp.paths].some((x) => String(x.id).startsWith('sample:'));

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader title="Sync & Import" subtitle={`Bring data into ${comp.name}`} actions={busy === 'import' && <Spinner />} />

        <div className="stat-grid four">
          <Stat label="Match records" value={comp.matches.length} tone="accent" />
          <Stat label="Pit profiles" value={comp.pits.length} tone="ok" />
          <Stat label="Robot paths" value={comp.paths.length} tone="pink" />
          <Stat label="Match videos" value={comp.videos.length} tone="teal" />
        </div>

        <div className="grid-2">
          <div className="col">
            <Card title="Scouting phones" subtitle="Pulls match and pit files over USB with ADB while connected" actions={<Badge tone={adb.running ? 'ok' : 'neutral'}>{adb.running ? 'Listening' : 'Stopped'}</Badge>}>
              <div className="stack">
                {!adb.available && <div className="notice warn">ADB was not found. Install Android platform-tools (macOS: <code>brew install android-platform-tools</code>), then restart Packout.</div>}
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">{adb.devices.length ? `${adb.devices.length} device${adb.devices.length === 1 ? '' : 's'}: ${adb.devices.join(', ')}` : 'No phones connected'}</span>
                  <Button variant={adb.running ? 'secondary' : 'primary'} icon={adb.running ? 'stop' : 'play'} onClick={toggleAdb} disabled={!adb.available}>{adb.running ? 'Stop' : 'Start'}</Button>
                </div>
                <p className="muted">Enable USB debugging on each phone. New files are stored safely inside Packout and imported automatically.</p>
                {adbLog.length > 0 && <LogBox lines={adbLog} height={110} />}
              </div>
            </Card>

            <Card title="Import files">
              <div className={`drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
                <Icon name="upload" size={24} />
                <p style={{ margin: '6px 0 12px' }}>Drop folders or files here — match / pit JSON, path CSVs and videos.</p>
                <div className="row" style={{ justifyContent: 'center' }}>
                  <Button variant="primary" icon="folder" onClick={chooseFolders}>Choose folders…</Button>
                  <Button icon="sync" onClick={rescan}>Rescan default folders</Button>
                </div>
              </div>
              <label className="row" style={{ marginTop: 12, gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={Boolean(settings.autoImportFolders)} onChange={(e) => store.updateSettings({ autoImportFolders: e.target.checked })} />
                <span>Import from these folders automatically when Packout opens <small className="muted">(off by default — a new install starts empty)</small></span>
              </label>
              <div style={{ marginTop: 14 }}>
                {folders.map((f) => (
                  <div className="health-row" key={f.id}>
                    <span><i className={`dot ${f.exists ? '' : 'warn'}`} />{f.label}<small className="muted" style={{ marginLeft: 8 }}>{f.path.replace(/^\/Users\/[^/]+/, '~')}</small></span>
                    {f.exists ? <button type="button" className="link-btn" onClick={() => api.shell.reveal(f.path)}>Show</button> : <span className="muted">missing</span>}
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="col">
            <Card title="Match schedule" subtitle={comp.schedule.length ? `${comp.schedule.length} matches loaded` : 'No schedule loaded'}>
              <div className="stack">
                <Field label="Event key" hint="e.g. 2026pncmp — find it in the event URL on The Blue Alliance.">
                  <input className="input" value={eventKey} onChange={(e) => setEventKey(e.target.value)} placeholder="2026pncmp" spellCheck={false} />
                </Field>
                {!settings.tbaApiKey && <div className="notice warn">Add a Blue Alliance API key in <button type="button" className="link-btn" onClick={() => store.go('settings')}>Settings</button> to fetch schedules.</div>}
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <Button variant="primary" icon="download" onClick={fetchSchedule} loading={busy === 'schedule'} disabled={!eventKey.trim() || !settings.tbaApiKey}>Fetch from Blue Alliance</Button>
                  <Button onClick={useBundled}>Use bundled schedule</Button>
                </div>
              </div>
            </Card>

            <Card title="Share with another Packout" subtitle="One file with everything you see: scouting, pit photos, paths, schedule, notes and TBA data">
              <div className="stack">
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <Button variant="primary" icon="download" loading={busy === 'share'} onClick={exportShare}>Export share file…</Button>
                  <Button icon="upload" onClick={importShare}>Import share file…</Button>
                </div>
                <p className="muted">Send the <code>.packout</code> file by AirDrop, email or chat. The other person imports it and sees the same teams, rankings and plans — no account or server needed.</p>
              </div>
            </Card>

            <Card title="Data tools">
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {comp.matches.length === 0 && comp.pits.length === 0 && <Button icon="sparkles" onClick={() => store.loadSampleData()}>Load demo data</Button>}
                {hasDemo && <Button onClick={() => clear('samples')}>Remove demo data</Button>}
                <Button variant="danger" icon="trash" onClick={() => clear('paths')} disabled={!comp.paths.length}>Clear paths</Button>
                <Button variant="danger" icon="trash" onClick={() => clear('all')} disabled={!comp.matches.length && !comp.pits.length && !comp.paths.length}>Clear all data</Button>
              </div>
            </Card>

            <Card title="Activity">
              <LogBox lines={[...comp.log].reverse().map((l) => l.replace(/^(\d{4}-\d\d-\d\d)T(\d\d:\d\d):\d\d\.\d+Z\s+/, '$2  '))} height={170} />
            </Card>
          </div>
        </div>
      </div>
      {incoming && (
        <Modal title="Import shared competition" width={500} onClose={() => setIncoming(null)}
          footer={<><Button onClick={() => setIncoming(null)}>Cancel</Button><Button onClick={() => confirmImport('new')}>Add as new competition</Button><Button variant="primary" onClick={() => confirmImport('merge')}>Merge into “{comp.name}”</Button></>}>
          <div className="stack">
            <div><strong style={{ fontSize: 16 }}>{incoming.info.name}</strong>{incoming.info.eventKey && <span className="muted"> · {incoming.info.eventKey}</span>}</div>
            <div className="mini-stats">
              <div><span>Match records</span><strong>{incoming.info.counts.matches}</strong></div>
              <div><span>Pit profiles</span><strong>{incoming.info.counts.pits}</strong></div>
              <div><span>Robot paths</span><strong>{incoming.info.counts.paths}</strong></div>
            </div>
            <p className="muted">{incoming.info.exportedAt ? `Exported ${new Date(incoming.info.exportedAt).toLocaleString()}. ` : ''}{incoming.info.hasTba ? 'Includes a snapshot of Blue Alliance data. ' : ''}<strong>Merge</strong> adds anything new to your current competition (nothing of yours is overwritten); <strong>Add as new</strong> keeps it separate.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
