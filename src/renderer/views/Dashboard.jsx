import React, { useMemo } from 'react';
import { api } from '../api';
import { store, useCurrent, useSummaries } from '../store';
import { Badge, Button, Card, Empty, PageHeader, RoleTag, Stat, fmt, pct } from '../components/ui';
import { BarList } from '../components/charts';
import { importPaths } from '../lib/importing';

function AllianceRow({ color, teams, onPick }) {
  return (
    <div className={`alliance ${color}`}>
      <b>{color}</b>
      {teams.map((t) => (
        <button key={t} type="button" className="team-chip" onClick={() => onPick(t)}>{t}</button>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const comp = useCurrent();
  const summaries = useSummaries();

  const info = useMemo(() => {
    const scoutedMatches = new Set(comp.matches.map((m) => Number(m.matchNumber)));
    const unscouted = comp.schedule.filter((s) => !scoutedMatches.has(s.matchNumber));
    const notes = comp.matches
      .filter((m) => m.notes.trim())
      .sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)))
      .slice(0, 5);
    const pitTeams = new Set(comp.pits.map((p) => p.teamNumber));
    return {
      unscouted,
      notes,
      lowSample: summaries.filter((s) => s.matchCount > 0 && s.matchCount < 3).length,
      highRisk: summaries.filter((s) => s.riskLabel === 'High').length,
      noPit: summaries.filter((s) => !pitTeams.has(s.teamNumber)).length,
      noPath: summaries.filter((s) => s.pathCoverage === 0).length,
    };
  }, [comp, summaries]);

  const avgEff = summaries.length ? summaries.reduce((a, s) => a + s.shootingEfficiency, 0) / summaries.length : 0;
  const open = (team) => { store.setSelectedTeam(team); store.go('picklist'); };

  const rescan = async () => {
    const folders = await api.sync.defaultFolders();
    const existing = folders.filter((f) => f.exists).map((f) => f.path);
    if (!existing.length) return store.toast('No default scouting folders found in Documents.', 'info');
    const n = await importPaths(existing, 'default folders');
    store.toast(n ? `Imported ${n} record${n === 1 ? '' : 's'}` : 'Everything is already up to date', n ? 'success' : 'info');
  };

  const empty = comp.matches.length === 0 && comp.pits.length === 0;

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          title="Dashboard"
          subtitle={comp.name}
          actions={
            <>
              <Button icon="sync" onClick={rescan}>Rescan folders</Button>
              {empty && <Button variant="primary" icon="sparkles" onClick={() => store.loadSampleData()}>Load demo data</Button>}
            </>
          }
        />

        <div className="stat-grid four">
          <Stat label="Teams ranked" value={summaries.length} hint={`${comp.pits.length} pit profiles`} tone="accent" />
          <Stat label="Matches scouted" value={comp.matches.length} hint={comp.schedule.length ? `${comp.schedule.length - info.unscouted.length}/${comp.schedule.length} scheduled matches covered` : 'no schedule loaded'} tone="teal" />
          <Stat label="Avg efficiency" value={pct(avgEff)} hint="made ÷ attempted" tone="ok" />
          <Stat label="Robot paths" value={comp.paths.length} hint={`${summaries.length - info.noPath} teams with path data`} tone="pink" />
        </div>

        {empty ? (
          <Card>
            <Empty
              icon="phone"
              title="No scouting data yet"
              body="Connect a scouting phone, import a folder of match JSON files, or load the demo dataset to explore the app."
              action={<div className="row"><Button variant="primary" icon="sync" onClick={() => store.go('sync')}>Go to Sync</Button><Button icon="sparkles" onClick={() => store.loadSampleData()}>Load demo data</Button></div>}
            />
          </Card>
        ) : (
          <div className="grid-main">
            <div className="col">
              <Card title="Top teams" subtitle="By pick score — click a team to open it in the picklist" actions={<Button size="sm" variant="ghost" onClick={() => store.go('picklist')}>Full picklist</Button>}>
                <BarList
                  items={summaries.slice(0, 10).map((s) => ({ key: s.teamNumber, label: s.teamNumber, value: s.pickScore }))}
                  onSelect={open}
                  max={100}
                />
              </Card>
              <Card title="Latest scouting notes">
                {info.notes.length === 0 ? (
                  <p className="muted">No notes recorded yet.</p>
                ) : (
                  info.notes.map((m) => (
                    <div className="note-item" key={m.id}>
                      <div className="meta"><span>Team {m.teamNumber}</span><Badge>Q{m.matchNumber}</Badge></div>
                      <p>{m.notes}</p>
                    </div>
                  ))
                )}
              </Card>
            </div>

            <div className="col">
              <Card title="Data health">
                <div className="health-row"><span><i className={`dot ${info.lowSample ? 'warn' : ''}`} />Teams with fewer than 3 matches</span><strong>{info.lowSample}</strong></div>
                <div className="health-row"><span><i className={`dot ${info.highRisk ? 'danger' : ''}`} />High-risk teams</span><strong>{info.highRisk}</strong></div>
                <div className="health-row"><span><i className={`dot ${info.noPit ? 'warn' : ''}`} />Teams without a pit record</span><strong>{info.noPit}</strong></div>
                <div className="health-row"><span><i className={`dot ${info.noPath ? 'warn' : ''}`} />Teams without path data</span><strong>{info.noPath}</strong></div>
              </Card>
              <Card
                title="Matches still to scout"
                subtitle={comp.schedule.length ? `${info.unscouted.length} of ${comp.schedule.length} have no scouting rows` : undefined}
              >
                {comp.schedule.length === 0 ? (
                  <p className="muted">No schedule loaded. Fetch it from The Blue Alliance in <button type="button" className="link-btn" onClick={() => store.go('sync')}>Sync</button>.</p>
                ) : info.unscouted.length === 0 ? (
                  <p className="muted">Every scheduled match has scouting data. 🎉</p>
                ) : (
                  info.unscouted.slice(0, 6).map((m) => (
                    <div className="sched-item" key={m.matchNumber}>
                      <div className="sched-top"><span>{m.name}</span><span>{m.timeLabel}</span></div>
                      <AllianceRow color="red" teams={m.redTeams} onPick={open} />
                      <AllianceRow color="blue" teams={m.blueTeams} onPick={open} />
                    </div>
                  ))
                )}
              </Card>
              {summaries[0] && (
                <Card title="Leader">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <strong style={{ fontSize: 20 }}>Team {summaries[0].teamNumber}</strong>
                      <div className="muted">{fmt(summaries[0].averageScore)} avg pts · {pct(summaries[0].shootingEfficiency)} efficiency</div>
                    </div>
                    <RoleTag role={summaries[0].role} />
                  </div>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
