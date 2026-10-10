import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { store, useApp, useCurrent } from './store';
import { Button, DialogHost, Empty, Field, Icon, Logo, Modal, Toasts, confirmDialog } from './components/ui';
import CompetitionModal from './components/CompetitionModal';
import Dashboard from './views/Dashboard';
import Picklist from './views/Picklist';
import Teams from './views/Teams';
import Analysis from './views/Analysis';
import Film from './views/Film';
import Trace from './views/Trace';
import Pit from './views/Pit';
import Sync from './views/Sync';
import Settings from './views/Settings';
import Onboarding from './views/Onboarding';
import { importPaths } from './lib/importing';

const NAV = [
  { group: 'Scout', items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'picklist', label: 'Picklist', icon: 'picklist' },
    { id: 'teams', label: 'Teams', icon: 'users' },
    { id: 'analysis', label: 'Analysis', icon: 'chart' },
  ] },
  { group: 'Review', items: [
    { id: 'film', label: 'Film Review', icon: 'film' },
    { id: 'trace', label: 'AI Trace', icon: 'route' },
    { id: 'pit', label: 'Pit Scouting', icon: 'wrench' },
  ] },
  { group: 'Data', items: [
    { id: 'sync', label: 'Sync & Import', icon: 'sync' },
    { id: 'settings', label: 'Settings', icon: 'sliders' },
  ] },
];

const VIEWS = { dashboard: Dashboard, picklist: Picklist, teams: Teams, analysis: Analysis, film: Film, trace: Trace, pit: Pit, sync: Sync, settings: Settings };

function CompSwitcher({ onNew }) {
  const { competitions, currentId } = useApp();
  const current = useCurrent();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const remove = async () => {
    setOpen(false);
    const ok = await confirmDialog({
      title: 'Delete competition?',
      message: `“${current.name}” and all of its scouting data, paths and picklist will be permanently removed from this computer.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) store.deleteCompetition(current.id);
  };

  return (
    <div className="comp-switcher" ref={ref}>
      <button type="button" className="comp-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="comp-icon"><Icon name="trophy" size={16} /></span>
        <span className="comp-text">
          <strong>{current ? current.name : 'No competition'}</strong>
          <small>{current?.eventKey || (current ? 'No event key' : 'Create one to begin')}</small>
        </span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="popover">
          <div className="popover-list">
            {competitions.map((c) => (
              <button key={c.id} type="button" className={`popover-item ${c.id === currentId ? 'active' : ''}`} onClick={() => { store.switchCompetition(c.id); setOpen(false); }}>
                <span>{c.name}</span>
                {c.id === currentId && <Icon name="check" size={15} />}
              </button>
            ))}
            {competitions.length === 0 && <div className="popover-empty">No competitions yet</div>}
          </div>
          <div className="popover-sep" />
          <button type="button" className="popover-item" onClick={() => { setOpen(false); onNew(); }}><Icon name="plus" size={15} /> New competition…</button>
          {current && (
            <>
              <button type="button" className="popover-item" onClick={() => { setName(current.name); setRenaming(true); setOpen(false); }}>Rename…</button>
              <button type="button" className="popover-item danger" onClick={remove}>Delete…</button>
            </>
          )}
        </div>
      )}
      {renaming && (
        <Modal
          title="Rename competition"
          width={420}
          onClose={() => setRenaming(false)}
          footer={<><Button onClick={() => setRenaming(false)}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={() => { store.updateCompetition({ name: name.trim() }); setRenaming(false); }}>Save</Button></>}
        >
          <Field label="Name"><input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && (store.updateCompetition({ name: name.trim() }), setRenaming(false))} /></Field>
        </Modal>
      )}
    </div>
  );
}

function Sidebar({ onNew }) {
  const { page, saveState, settings } = useApp();
  const theme = settings.theme || 'system';
  const nextTheme = { system: 'light', light: 'dark', dark: 'system' }[theme];
  return (
    <aside className="sidebar">
      <div className="brand drag">
        <Logo size={26} />
        <span>Packout</span>
      </div>
      <CompSwitcher onNew={onNew} />
      <nav>
        {NAV.map((g) => (
          <div key={g.group} className="nav-group">
            <div className="nav-label">{g.group}</div>
            {g.items.map((it) => (
              <button key={it.id} type="button" className={`nav-item ${page === it.id ? 'active' : ''}`} onClick={() => store.go(it.id)}>
                <Icon name={it.icon} size={17} />
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <span className={`save-state ${saveState}`} title="Your data is stored locally on this computer">
          <i /> {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved locally'}
        </span>
        <button type="button" className="icon-btn" title={`Theme: ${theme} (click for ${nextTheme})`} onClick={() => store.updateSettings({ theme: nextTheme })}>
          <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'layers'} size={16} />
        </button>
      </div>
    </aside>
  );
}

export default function App() {
  const { ready, page, settings } = useApp();
  const comp = useCurrent();
  const [showNew, setShowNew] = useState(false);
  const bootstrapped = useRef(false);
  const autoPrompted = useRef(false);

  useEffect(() => {
    store.init();
  }, []);

  // Pull anything already sitting in the default folders once the workspace is open.
  useEffect(() => {
    if (!ready || !comp || bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      try {
        const folders = await api.sync.defaultFolders();
        const existing = folders.filter((f) => f.exists).map((f) => f.path);
        if (existing.length) await importPaths(existing, 'default folders');
      } catch (e) {
        console.error(e);
      }
    })();
  }, [ready, comp]);

  // Phone transfers land while the user may be on any page.
  useEffect(() => {
    return api.adb.onEvent(async (ev) => {
      if (ev.type !== 'transferred') return;
      try {
        const n = await importPaths([ev.path], 'phone transfer');
        store.toast(n ? `Imported ${n} new record${n === 1 ? '' : 's'} from the phone` : 'Phone transfer finished — nothing new', n ? 'success' : 'info');
      } catch (e) {
        store.toast(`Import failed: ${e.message}`, 'error');
      }
    });
  }, []);

  // First run: guide straight into creating a competition.
  const nothingYet = ready && settings.onboardingDone && !comp && page !== 'settings';
  useEffect(() => {
    if (nothingYet && !autoPrompted.current) {
      autoPrompted.current = true;
      setShowNew(true);
    }
  }, [nothingYet]);

  if (!ready) return <div className="boot"><Logo size={44} /></div>;
  if (!settings.onboardingDone) return <><Onboarding /><Toasts /></>;

  const View = VIEWS[page] || Dashboard;
  const needsComp = !comp && page !== 'settings';

  return (
    <div className="app">
      <Sidebar onNew={() => setShowNew(true)} />
      <main className="main">
        <div className="titlebar drag" />
        {needsComp ? (
          <div className="page-center">
            <Empty
              icon="trophy"
              title="Start a competition"
              body="Create a workspace for your event. You can pull the match schedule from The Blue Alliance or set it up manually."
              action={<Button variant="primary" icon="plus" onClick={() => setShowNew(true)}>New competition</Button>}
            />
          </div>
        ) : (
          <View key={`${page}:${comp?.id || ''}`} />
        )}
      </main>
      {showNew && <CompetitionModal onClose={() => setShowNew(false)} />}
      <DialogHost />
      <Toasts />
    </div>
  );
}
