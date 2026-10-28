import React, { useMemo, useState } from 'react';
import { api } from '../api';
import { store, useCurrent } from '../store';
import { Badge, Button, Card, Empty, PageHeader, Segmented, fmt } from '../components/ui';
import { teamTable, pointsFor } from '../../shared/designSchema';
import { naturalNumber } from '../../shared/models';

/**
 * Generic analysis for data recorded by a Scout Studio design. Nothing here knows
 * the game: columns come from whatever the phone app recorded.
 */
export default function Custom() {
  const comp = useCurrent();
  const records = useMemo(() => comp.matches.filter((m) => m.custom), [comp.matches]);
  const { cols, rows } = useMemo(() => teamTable(records, comp.design), [records, comp.design]);
  const [sort, setSort] = useState({ key: null, dir: -1 });
  const [kind, setKind] = useState('all');
  const [mapTeam, setMapTeam] = useState('');
  const [mapField, setMapField] = useState('');

  const loadSchema = async () => {
    try {
      const file = await api.dialog.open([{ name: 'Scout Studio schema', extensions: ['json'] }], 'Choose schema.json from Scout Studio');
      if (!file) return;
      store.setDesignSchema(JSON.parse(await api.fs.readText(file)));
    } catch (e) {
      store.toast('Could not read schema: ' + e.message, 'error');
    }
  };

  const shownCols = cols.filter((c) => kind === 'all' || c.kind === kind);
  const sorted = [...rows].sort((a, b) => {
    if (!sort.key) return naturalNumber(a.team) - naturalNumber(b.team);
    const av = a.avg[sort.key] ?? -Infinity;
    const bv = b.avg[sort.key] ?? -Infinity;
    return (av - bv) * sort.dir;
  });
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: -1 }));

  const eventCols = cols.filter((c) => c.kind === 'events');
  const field = mapField || (eventCols[0] ? eventCols[0].key.slice(2) : '');
  const team = mapTeam || (sorted[0] ? sorted[0].team : '');
  const points = field && team ? pointsFor(records, team, field) : [];

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          title="Custom Data"
          subtitle={comp.design ? `Design: ${comp.design.meta?.name || 'unnamed'}` : 'Averages for every field your Scout Studio design records'}
          actions={<Button onClick={loadSchema}>{comp.design ? 'Replace schema…' : 'Load schema…'}</Button>}
        />
        {records.length === 0 ? (
          <Card><Empty icon="chart" title="No custom records yet" body="Records from an app built in Scout Studio show up here automatically after you sync. Load the exported schema.json for friendly column names." action={<Button variant="primary" onClick={() => store.go('sync')}>Go to Sync</Button>} /></Card>
        ) : (
          <>
            <div className="row" style={{ marginBottom: 14, gap: 12 }}>
              <Segmented value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'value', label: 'Fields' }, { value: 'computed', label: 'Calculated' }, { value: 'events', label: 'Events' }]} />
              <Badge>{rows.length} teams · {records.length} matches</Badge>
            </div>
            <Card flush>
              <div style={{ overflow: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Team</th><th>Matches</th>
                      {shownCols.map((c) => (
                        <th key={c.key} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => toggleSort(c.key)}>
                          {c.label}{c.kind === 'events' ? ' (count)' : ''}{sort.key === c.key ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr key={r.team}>
                        <td><button type="button" className="link" onClick={() => { store.setSelectedTeam(r.team); store.go('teams'); }}>{r.team}</button></td>
                        <td>{r.matches}</td>
                        {shownCols.map((c) => <td key={c.key}>{fmt(r.avg[c.key], 1)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {eventCols.length > 0 && (
              <Card title="Tap locations" subtitle="Every point scouts tapped on a field map, across all matches" className="" style={{ marginTop: 16 }}>
                <div className="row" style={{ gap: 10, marginBottom: 12 }}>
                  <select className="select" value={field} onChange={(e) => setMapField(e.target.value)}>
                    {eventCols.map((c) => <option key={c.key} value={c.key.slice(2)}>{c.label}</option>)}
                  </select>
                  <select className="select" value={team} onChange={(e) => setMapTeam(e.target.value)}>
                    {sorted.map((r) => <option key={r.team} value={r.team}>Team {r.team}</option>)}
                  </select>
                  <Badge>{points.length} points</Badge>
                </div>
                <svg viewBox="0 0 100 60" style={{ width: '100%', maxWidth: 640, background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  {[25, 50, 75].map((x) => <line key={x} x1={x} x2={x} y1={0} y2={60} stroke="var(--border)" strokeWidth="0.3" />)}
                  {[15, 30, 45].map((y) => <line key={y} y1={y} y2={y} x1={0} x2={100} stroke="var(--border)" strokeWidth="0.3" />)}
                  {points.map((p, i) => <circle key={i} cx={p.x * 100} cy={p.y * 60} r="1.6" fill="var(--accent)" fillOpacity="0.55"><title>{`Match ${p.match} · ${p.name}`}</title></circle>)}
                </svg>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
