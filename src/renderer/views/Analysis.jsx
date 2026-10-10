import React, { useMemo, useState } from 'react';
import { getSummaries, store, useApp, useCurrent } from '../store';
import { Button, Card, Empty, PageHeader, Segmented, SearchInput, Stat, fmt, pct } from '../components/ui';
import { BarList, Distribution, LineChart, Scatter } from '../components/charts';
import { median, percentile, stddev } from '../../shared/analytics';
import DeepDive, { Compare } from './DeepDive';
import { estimatedScore, byNatural, naturalNumber } from '../../shared/models';

const METRICS = [
  { id: 'pickScore', title: 'Pick score', value: (s) => s.pickScore, fmt: (v) => fmt(v) },
  { id: 'averageScore', title: 'Avg points', value: (s) => s.averageScore, fmt: (v) => fmt(v) },
  { id: 'efficiency', title: 'Efficiency', value: (s) => s.shootingEfficiency * 100, fmt: (v) => `${fmt(v, 0)}%` },
  { id: 'reliability', title: 'Reliability', value: (s) => s.reliability, fmt: (v) => fmt(v, 0) },
  { id: 'defense', title: 'Defense', value: (s) => s.defenseIndex, fmt: (v) => fmt(v, 0) },
  { id: 'downtime', title: 'Downtime', value: (s) => s.averageBrokeSeconds, fmt: (v) => `${fmt(v, 0)}s` },
];

const COLUMNS = [
  ['rank', 'Rank', (s) => s.rank, (v) => v],
  ['team', 'Team', (s) => naturalNumber(s.teamNumber), (v, s) => s.teamNumber],
  ['matches', 'Matches', (s) => s.matchCount, (v) => v],
  ['pick', 'Pick', (s) => s.pickScore, (v) => fmt(v)],
  ['avg', 'Avg pts', (s) => s.averageScore, (v) => fmt(v)],
  ['eff', 'Eff', (s) => s.shootingEfficiency, (v) => pct(v)],
  ['rel', 'Rel', (s) => s.reliability, (v) => fmt(v, 0)],
  ['def', 'Def', (s) => s.defenseIndex, (v) => fmt(v, 0)],
  ['climb', 'Climb', (s) => s.climbRate, (v) => pct(v)],
  ['down', 'Down', (s) => s.averageBrokeSeconds, (v) => `${fmt(v, 0)}s`],
];

function Overview() {
  const comp = useCurrent();
  const { selectedTeam } = useApp();
  const summaries = getSummaries(comp);
  const [metricId, setMetricId] = useState('pickScore');
  const [filterMode, setFilterMode] = useState('all');
  const [picked, setPicked] = useState(() => new Set());
  const [teamSearch, setTeamSearch] = useState('');
  const [match, setMatch] = useState(comp.schedule[0]?.matchNumber ?? '');
  const [sort, setSort] = useState({ key: 'rank', dir: 1 });

  const metric = METRICS.find((m) => m.id === metricId);
  const visible = useMemo(() => {
    if (filterMode === 'selected' && picked.size) return summaries.filter((s) => picked.has(s.teamNumber));
    if (filterMode === 'match') {
      const m = comp.schedule.find((s) => s.matchNumber === Number(match));
      const teams = new Set(m ? [...m.redTeams, ...m.blueTeams] : []);
      return teams.size ? summaries.filter((s) => teams.has(s.teamNumber)) : summaries;
    }
    return summaries;
  }, [summaries, filterMode, picked, match, comp.schedule]);

  const team = selectedTeam && visible.some((s) => s.teamNumber === selectedTeam) ? selectedTeam : visible[0]?.teamNumber;
  const teamRecords = useMemo(() => comp.matches.filter((m) => m.teamNumber === team).sort((a, b) => byNatural(a.matchNumber, b.matchNumber)), [comp.matches, team]);

  const insights = useMemo(() => {
    const avgs = visible.map((s) => s.averageScore);
    const clutch = [...visible].sort((a, b) => b.averageScore * b.reliability * Math.max(0.1, 100 - b.averageBrokeSeconds) - a.averageScore * a.reliability * Math.max(0.1, 100 - a.averageBrokeSeconds))[0];
    return {
      depth: visible.filter((s) => s.matchCount >= 3).length,
      volatility: stddev(avgs),
      floor: percentile(visible.map((s) => s.reliability), 0.25),
      median: median(avgs),
      avg: avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : 0,
      clutch: clutch?.teamNumber,
    };
  }, [visible]);

  const roles = useMemo(() => {
    const counts = new Map();
    visible.forEach((s) => counts.set(s.role, (counts.get(s.role) || 0) + 1));
    const tone = { 'Captain Core': 'accent', 'Defense Anchor': 'danger', 'Efficient Scorer': 'ok', 'Endgame Value': 'warn', 'First Round': 'violet', Depth: 'neutral' };
    return [...counts].map(([label, value]) => ({ label, value, tone: tone[label] || 'neutral' }));
  }, [visible]);

  const table = useMemo(() => {
    const col = COLUMNS.find((c) => c[0] === sort.key) || COLUMNS[0];
    return [...visible].sort((a, b) => (col[2](a) - col[2](b)) * sort.dir);
  }, [visible, sort]);

  if (summaries.length === 0) {
    return <Card><Empty icon="chart" title="No data to chart" body="Import scouting data or load the demo dataset." action={<Button variant="primary" onClick={() => store.loadSampleData()}>Load demo data</Button>} /></Card>;
  }

  const sortedTeams = [...summaries].sort((a, b) => naturalNumber(a.teamNumber) - naturalNumber(b.teamNumber));
  const togglePick = (t) => setPicked((p) => { const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n; });

  return (
    <>

        <Card>
          <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <Segmented value={metricId} onChange={setMetricId} options={METRICS.map((m) => ({ value: m.id, label: m.title }))} />
            <Segmented value={filterMode} onChange={setFilterMode} options={[{ value: 'all', label: 'All teams' }, { value: 'selected', label: 'Selected' }, { value: 'match', label: 'By match' }]} />
          </div>
          {filterMode === 'selected' && (
            <div className="stack" style={{ marginTop: 12 }}>
              <div className="row"><SearchInput className="grow" value={teamSearch} onChange={setTeamSearch} placeholder="Filter team numbers…" /><Button size="sm" variant="ghost" onClick={() => setPicked(new Set())} disabled={!picked.size}>Clear</Button></div>
              <div className="pill-row" style={{ maxHeight: 96, overflowY: 'auto' }}>
                {sortedTeams.filter((s) => !teamSearch.trim() || s.teamNumber.includes(teamSearch.trim())).map((s) => (
                  <button key={s.teamNumber} type="button" className={`chip ${picked.has(s.teamNumber) ? 'on' : ''}`} onClick={() => togglePick(s.teamNumber)}>{s.teamNumber}</button>
                ))}
              </div>
              <span className="muted">{picked.size ? `${picked.size} selected` : 'Nothing selected — showing all teams.'}</span>
            </div>
          )}
          {filterMode === 'match' && (
            <div className="row" style={{ marginTop: 12 }}>
              {comp.schedule.length === 0 ? <span className="muted">No schedule loaded — fetch one in Sync.</span> : (
                <>
                  <select className="select" value={match} onChange={(e) => setMatch(e.target.value)}>
                    {comp.schedule.map((m) => <option key={m.matchNumber} value={m.matchNumber}>{m.name}</option>)}
                  </select>
                  <span className="muted">Shows the six teams scheduled in that match.</span>
                </>
              )}
            </div>
          )}
        </Card>

        <div className="stat-grid three" style={{ marginTop: 16 }}>
          <Stat label="Data depth" value={`${insights.depth}/${visible.length}`} hint="teams with 3+ matches" tone="accent" />
          <Stat label="League average" value={fmt(insights.avg)} hint={`median ${fmt(insights.median)} · σ ${fmt(insights.volatility)}`} tone="teal" />
          <Stat label="Clutch leader" value={insights.clutch ? `Team ${insights.clutch}` : '–'} hint={`reliability floor ${fmt(insights.floor, 0)}`} tone="pink" />
        </div>

        <div className="grid-2">
          <Card title={metric.title} subtitle="Top 12 in view">
            <BarList
              items={[...visible].sort((a, b) => metric.value(b) - metric.value(a)).slice(0, 12).map((s) => ({ key: s.teamNumber, label: s.teamNumber, value: metric.value(s) }))}
              format={metric.fmt}
              selected={team}
              onSelect={store.setSelectedTeam}
            />
          </Card>
          <Card title="Reliability vs output" subtitle="Top-right is best: consistent and high scoring">
            <Scatter
              points={visible.map((s) => ({ key: s.teamNumber, label: `Team ${s.teamNumber}`, x: s.reliability, y: s.averageScore }))}
              xLabel="Reliability"
              yLabel="Avg points"
              selected={team}
              onSelect={store.setSelectedTeam}
            />
          </Card>
          <Card title={team ? `Team ${team} trend` : 'Team trend'} subtitle="Estimated points per match (click a bar or dot to change team)">
            {teamRecords.length > 0 ? <LineChart points={teamRecords.map((m) => ({ x: `Q${m.matchNumber}`, y: estimatedScore(m) }))} yLabel="Points" /> : <p className="muted">No matches for this team.</p>}
          </Card>
          <Card title="Role mix">
            <Distribution items={roles} />
          </Card>
        </div>

        <Card title="Leaderboard" subtitle="Click a column header to sort" flush>
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  {COLUMNS.map(([key, label]) => (
                    <th key={key} className={`sortable ${key !== 'team' && key !== 'rank' ? 'num' : ''}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === 'rank' || key === 'team' ? 1 : -1 }))}>
                      {label}{sort.key === key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.map((s) => (
                  <tr key={s.teamNumber} className={`clickable ${team === s.teamNumber ? 'selected' : ''}`} onClick={() => store.setSelectedTeam(s.teamNumber)}>
                    {COLUMNS.map(([key, , get, show]) => (
                      <td key={key} className={key !== 'team' && key !== 'rank' ? 'num' : ''}>{key === 'team' ? <strong>{s.teamNumber}</strong> : show(get(s), s)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
    </>
  );
}

export default function Analysis() {
  const [tab, setTab] = useState('overview');
  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          title="Analysis"
          subtitle="League overview, single-team deep dives and head-to-head comparison"
          actions={<Segmented value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Overview' }, { value: 'deep', label: 'Team deep dive' }, { value: 'compare', label: 'Compare' }]} />}
        />
        <div key={tab} className="tab-body">
          {tab === 'overview' && <Overview />}
          {tab === 'deep' && <DeepDive />}
          {tab === 'compare' && <Compare />}
        </div>
      </div>
    </div>
  );
}
