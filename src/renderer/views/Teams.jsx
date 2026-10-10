import React, { useMemo, useState } from 'react';
import { getSummaries, store, useApp, useCurrent } from '../store';
import { Card, Empty, PageHeader, RankBadge, RoleTag, SearchInput, Segmented, Button, fmt } from '../components/ui';
import TeamDetail from '../components/TeamDetail';
import { naturalNumber } from '../../shared/models';

export default function Teams() {
  const comp = useCurrent();
  const { selectedTeam } = useApp();
  const summaries = getSummaries(comp);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('rank');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = summaries.filter((s) => !q || s.teamNumber.includes(q) || s.role.toLowerCase().includes(q));
    if (sort === 'number') return [...list].sort((a, b) => naturalNumber(a.teamNumber) - naturalNumber(b.teamNumber));
    if (sort === 'avg') return [...list].sort((a, b) => b.averageScore - a.averageScore);
    return list;
  }, [summaries, search, sort]);

  const selected = selectedTeam && summaries.some((s) => s.teamNumber === selectedTeam) ? selectedTeam : rows[0]?.teamNumber;

  if (summaries.length === 0) {
    return (
      <div className="page"><div className="page-inner">
        <PageHeader title="Teams" subtitle="Profiles, match history, pit data and robot paths" />
        <Card><Empty icon="users" title="No teams yet" body="Teams appear once scouting, pit or path data is imported." action={<Button variant="primary" onClick={() => store.go('sync')}>Import data</Button>} /></Card>
      </div></div>
    );
  }

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader title="Teams" subtitle={`${summaries.length} teams at ${comp.name}`} />
        <div className="split">
          <div className="col">
            <div className="row">
              <SearchInput className="grow" value={search} onChange={setSearch} placeholder="Search team or role…" />
            </div>
            <Segmented size="sm" value={sort} onChange={setSort} options={[{ value: 'rank', label: 'By rank' }, { value: 'avg', label: 'By avg points' }, { value: 'number', label: 'By number' }]} />
            <div className="list">
              {rows.map((s) => (
                <button key={s.teamNumber} type="button" className={`team-row ${selected === s.teamNumber ? 'selected' : ''}`} onClick={() => store.setSelectedTeam(s.teamNumber)}>
                  <RankBadge rank={s.rank} />
                  <div className="main-col">
                    <div className="name">Team {s.teamNumber}</div>
                    <div className="sub"><RoleTag role={s.role} /><span>{s.matchCount} match{s.matchCount === 1 ? '' : 'es'}</span></div>
                  </div>
                  <div className="metric"><span>Pick</span><strong>{fmt(s.pickScore)}</strong></div>
                </button>
              ))}
              {rows.length === 0 && <p className="muted pad">No teams match “{search}”.</p>}
            </div>
          </div>
          <div className="sticky"><TeamDetail teamNumber={selected} /></div>
        </div>
      </div>
    </div>
  );
}
