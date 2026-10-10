import React, { useMemo, useState } from 'react';
import { mediaUrl } from '../api';
import { store, useCurrent } from '../store';
import { Badge, Button, Card, Empty, PageHeader, SearchInput } from '../components/ui';
import { DRIVETRAINS, naturalNumber, pitLabels } from '../../shared/models';

export default function Pit() {
  const comp = useCurrent();
  const [search, setSearch] = useState('');
  const [drive, setDrive] = useState('all');

  const rows = useMemo(() => {
    // newest record per team
    const latest = new Map();
    for (const p of comp.pits) {
      const prev = latest.get(p.teamNumber);
      if (!prev || String(p.importedAt) > String(prev.importedAt)) latest.set(p.teamNumber, p);
    }
    const q = search.trim().toLowerCase();
    return [...latest.values()]
      .filter((p) => (drive === 'all' || String(p.driveTrain) === drive) && (!q || p.teamNumber.includes(q) || p.notes.toLowerCase().includes(q)))
      .sort((a, b) => naturalNumber(a.teamNumber) - naturalNumber(b.teamNumber));
  }, [comp.pits, search, drive]);

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader title="Pit Scouting" subtitle="Robot configuration, photos and inspection notes" />
        {comp.pits.length === 0 ? (
          <Card><Empty icon="wrench" title="No pit records" body="Pit scouting files come from the scouting app on your phones. Sync them or load the demo data." action={<div className="row"><Button variant="primary" onClick={() => store.go('sync')}>Go to Sync</Button><Button onClick={() => store.loadSampleData()}>Load demo data</Button></div>} /></Card>
        ) : (
          <>
            <div className="row" style={{ marginBottom: 16 }}>
              <SearchInput className="grow" value={search} onChange={setSearch} placeholder="Search by team number or notes…" />
              <select className="select" value={drive} onChange={(e) => setDrive(e.target.value)} aria-label="Drivetrain">
                <option value="all">All drivetrains</option>
                {DRIVETRAINS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </div>
            <div className="grid-3">
              {rows.map((p) => {
                const L = pitLabels(p);
                const img = mediaUrl(p.imagePath);
                return (
                  <Card key={p.id} className="pit-card">
                    <button type="button" className="pit-open" onClick={() => { store.setSelectedTeam(p.teamNumber); store.go('teams'); }}>
                      <div className="pit-hero">{img ? <img src={img} alt={`Team ${p.teamNumber}`} loading="lazy" /> : <span>No photo</span>}</div>
                      <div className="row" style={{ justifyContent: 'space-between', margin: '12px 0 8px' }}>
                        <strong style={{ fontSize: 17 }}>Team {p.teamNumber}</strong>
                        <Badge tone="accent">{L.driveTrain}</Badge>
                      </div>
                      <dl className="spec-list">
                        <dt>Intake</dt><dd>{L.intake}</dd>
                        <dt>Launcher</dt><dd>{L.launcher}</dd>
                        <dt>Terrain</dt><dd>{L.terrain}</dd>
                        <dt>Width</dt><dd>{p.width ? `${p.width} in` : '–'}</dd>
                      </dl>
                      {p.notes && <p className="quote">“{p.notes}”</p>}
                    </button>
                  </Card>
                );
              })}
              {rows.length === 0 && <p className="muted">No pit records match.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
