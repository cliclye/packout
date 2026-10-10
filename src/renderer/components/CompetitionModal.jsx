import React, { useEffect, useMemo, useState } from 'react';
import { store, useApp } from '../store';
import { Button, Field, Modal, Segmented, SearchInput, Spinner } from './ui';
import { fetchEventSchedule, fetchEvents } from '../lib/tba';

/** Create a competition from a Blue Alliance event, or manually. */
export default function CompetitionModal({ onClose, firstRun = false }) {
  const { settings } = useApp();
  const hasKey = Boolean(settings.tbaApiKey);
  const [mode, setMode] = useState(hasKey ? 'tba' : 'manual');
  const [year, setYear] = useState(new Date().getFullYear());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [name, setName] = useState('');
  const [eventKey, setEventKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== 'tba' || !hasKey) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchEvents(year)
      .then((list) => !cancelled && setEvents(list))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [mode, year, hasKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? events.filter((e) => `${e.name} ${e.key} ${e.city || ''} ${e.state_prov || ''}`.toLowerCase().includes(q))
      : events;
    return list.slice(0, 80);
  }, [events, query]);

  const create = async () => {
    const finalName = mode === 'tba' ? picked?.name : name.trim();
    const key = mode === 'tba' ? picked?.key : eventKey.trim();
    if (!finalName) return;
    setBusy(true);
    const comp = store.createCompetition(finalName, key);
    if (key && hasKey) {
      try {
        const schedule = await fetchEventSchedule(key);
        if (schedule.length) store.replaceSchedule(schedule, `Blue Alliance ${key}`);
      } catch (e) {
        store.toast(`Created, but the schedule could not be loaded: ${e.message}`, 'warn');
      }
    }
    setBusy(false);
    store.toast(`Created “${comp.name}”`, 'success');
    onClose();
  };

  const canCreate = mode === 'tba' ? Boolean(picked) : Boolean(name.trim());

  return (
    <Modal
      title={firstRun ? 'Create your first competition' : 'New competition'}
      onClose={firstRun ? undefined : onClose}
      width={600}
      footer={
        <>
          {!firstRun && <Button onClick={onClose}>Cancel</Button>}
          <Button variant="primary" onClick={create} disabled={!canCreate} loading={busy}>Create competition</Button>
        </>
      }
    >
      <p className="modal-text">Each competition is its own workspace — scouting data, schedule, videos and picklist never mix.</p>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[{ value: 'tba', label: 'From Blue Alliance' }, { value: 'manual', label: 'Manual' }]}
      />
      {mode === 'tba' ? (
        !hasKey ? (
          <div className="notice">
            Add a Blue Alliance API key in <button type="button" className="link-btn" onClick={() => { onClose(); store.go('settings'); }}>Settings</button> to browse events and import schedules, or create the competition manually.
          </div>
        ) : (
          <div className="stack">
            <div className="row">
              <SearchInput className="grow" value={query} onChange={setQuery} placeholder="Search events by name, city or key…" />
              <select className="select" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Season">
                {[0, 1, 2, 3].map((d) => {
                  const y = new Date().getFullYear() - d;
                  return <option key={y} value={y}>{y}</option>;
                })}
              </select>
            </div>
            {error && <div className="notice error">{error}</div>}
            <div className="event-list">
              {loading ? (
                <div className="event-empty"><Spinner /> Loading events…</div>
              ) : filtered.length === 0 ? (
                <div className="event-empty">No events match.</div>
              ) : (
                filtered.map((e) => (
                  <button key={e.key} type="button" className={`event-row ${picked?.key === e.key ? 'selected' : ''}`} onClick={() => setPicked(e)}>
                    <span>
                      <strong>{e.name}</strong>
                      <small>{[e.city, e.state_prov].filter(Boolean).join(', ')}</small>
                    </span>
                    <span className="event-meta">
                      <code>{e.key}</code>
                      <small>{e.start_date}</small>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )
      ) : (
        <div className="stack">
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. PNW District Event #2" autoFocus />
          </Field>
          <Field label="Event key (optional)" hint="Used to pull the match schedule from The Blue Alliance, e.g. 2026pncmp.">
            <input className="input" value={eventKey} onChange={(e) => setEventKey(e.target.value)} placeholder="2026pncmp" spellCheck={false} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
