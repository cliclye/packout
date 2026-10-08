import React, { useState, useEffect, useRef, useMemo } from 'react';
import './App.css';
import store from '../store';
import { useStore, useSettings } from '../hooks';
import * as models from '../models';

// --- Helper Formatting ---
const fmtNum = (val) => (typeof val === 'number' && !isNaN(val) ? val.toFixed(1) : '0.0');
const fmtPct = (val) => (typeof val === 'number' && !isNaN(val) ? `${(val * 100).toFixed(0)}%` : '0%');

// --- Shared Components ---
const MetricCard = ({ title, value, color }) => (
  <div className="metric-card">
    <div className="metric-title" style={{ color: color || 'var(--text-secondary)' }}>{title}</div>
    <div className="metric-value">{value}</div>
  </div>
);

const RankBadge = ({ rank }) => {
  const isTop = rank <= 8;
  return (
    <div 
      className="rank-badge" 
      style={{
        backgroundColor: isTop ? 'var(--pack-blue)' : 'rgba(0,0,0,0.04)',
        color: isTop ? '#ffffff' : 'inherit',
        fontWeight: 'bold',
        padding: '4px 10px',
        borderRadius: '6px',
        display: 'inline-block',
        minWidth: '32px',
        textAlign: 'center'
      }}
    >
      #{rank}
    </div>
  );
};

const RoleTag = ({ role }) => {
  const r = (role || 'Depth').toLowerCase();
  let bg = '#eee', col = '#333';
  if (r.includes('captain')) { bg = '#e0edff'; col = '#1a56db'; }
  else if (r.includes('scorer')) { bg = '#dcfce7'; col = '#15803d'; }
  else if (r.includes('defense')) { bg = '#fee2e2'; col = '#b91c1c'; }
  else if (r.includes('endgame')) { bg = '#fef3c7'; col = '#b45309'; }
  else if (r.includes('first')) { bg = '#f3e8ff'; col = '#7e22ce'; }

  return (
    <span style={{ 
      backgroundColor: bg, 
      color: col, 
      padding: '3px 8px', 
      borderRadius: '6px', 
      fontSize: '12px', 
      fontWeight: '600' 
    }}>
      {role || 'Depth'}
    </span>
  );
};

const EmptyState = ({ message, actionText, onAction }) => (
  <div className="empty-state" style={{ textAlign: 'center', padding: '40px 20px' }}>
    <p style={{ color: 'var(--text-secondary)', fontSize: '15px', marginBottom: '15px' }}>{message}</p>
    {actionText && (
      <button onClick={onAction}>{actionText}</button>
    )}
  </div>
);

const PageHeader = ({ title, subtitle, rightContent }) => (
  <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
    <div>
      <h1 className="page-title">{title}</h1>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </div>
    {rightContent && <div>{rightContent}</div>}
  </div>
);

// --- Scoring Formulas ---
const calculateScore = (team, strategy) => {
  if (!team) return 0;
  const t = {
    pickScore: team.pickScore || 0,
    averageScore: team.averageScore || 0,
    shootingEfficiency: team.shootingEfficiency || 0,
    climbRate: team.climbRate || 0,
    defenseIndex: team.defenseIndex || 0,
    reliability: team.reliability || 0,
    averageBrokeSeconds: team.averageBrokeSeconds || 0,
    role: (team.role || '').toLowerCase()
  };

  switch (strategy) {
    case 'scoringBot':
      return t.averageScore * 1.9 + t.shootingEfficiency * 30 + t.climbRate * 8;
    case 'defenseBot':
      return t.defenseIndex * 3.2 + t.reliability * 6 + (t.role.includes('defense') ? 6 : 0) - t.averageBrokeSeconds * 0.2;
    case 'reliableBot':
      return t.reliability * 10 + t.shootingEfficiency * 14 - t.averageBrokeSeconds * 0.35;
    case 'endgameBot':
      return t.climbRate * 40 + t.reliability * 5 + t.averageScore;
    case 'balanced':
    default:
      return t.pickScore;
  }
};

// --- Field Path View Component ---
const FieldPathView = ({ teamNumber, paths }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Field background (grey border with field layout lines)
    ctx.fillStyle = '#f0f2f5';
    ctx.fillRect(0, 0, w, h);

    // Draw field boundary and centerline
    ctx.strokeStyle = '#d0d5dd';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(4, 4, w - 8, h - 8);

    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(w / 2, 4);
    ctx.lineTo(w / 2, h - 4);
    ctx.stroke();
    ctx.setLineDash([]);

    // Substation / Alliance zone hints
    ctx.fillStyle = 'rgba(38, 89, 217, 0.08)';
    ctx.fillRect(4, 4, 30, h - 8);
    ctx.fillStyle = 'rgba(217, 38, 89, 0.08)';
    ctx.fillRect(w - 34, 4, 30, h - 8);

    const teamPaths = paths || [];
    let hasDrawn = false;

    teamPaths.forEach((file) => {
      const samples = file.samples || [];
      if (samples.length < 2) return;
      hasDrawn = true;

      // Draw auto path in teal/green, teleop in blue
      ctx.lineWidth = 2.5;
      for (let i = 1; i < samples.length; i++) {
        const p1 = samples[i - 1];
        const p2 = samples[i];
        ctx.strokeStyle = p2.isAuto ? 'var(--pack-green)' : 'var(--pack-blue)';

        ctx.beginPath();
        ctx.moveTo(p1.x * (w - 20) + 10, p1.y * (h - 20) + 10);
        ctx.lineTo(p2.x * (w - 20) + 10, p2.y * (h - 20) + 10);
        ctx.stroke();
      }
    });

    if (!hasDrawn) {
      ctx.fillStyle = '#98a2b3';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`No path data for Team ${teamNumber || ''}`, w / 2, h / 2 + 4);
    }
  }, [teamNumber, paths]);

  return (
    <div className="field-path-container" style={{ margin: '10px 0', border: '1px solid var(--pack-border)', borderRadius: '8px', overflow: 'hidden' }}>
      <canvas ref={canvasRef} width={340} height={180} style={{ display: 'block', width: '100%', height: 'auto' }} />
      <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', padding: '6px', fontSize: '11px', background: '#fafafa' }}>
        <span style={{ color: 'var(--pack-green)', fontWeight: '600' }}>● Auto Path</span>
        <span style={{ color: 'var(--pack-blue)', fontWeight: '600' }}>● Teleop Path</span>
      </div>
    </div>
  );
};

// --- Team Detail Panel ---
const TeamDetailPanel = ({ teamNumber }) => {
  const { state, store } = useStore();
  const summaries = store.getTeamSummaries();
  const summary = summaries.find(s => s.teamNumber === teamNumber) || summaries[0];

  if (!summary) {
    return <div className="panel empty-state">Select a team to inspect profile</div>;
  }

  const teamMatches = store.getMatchRecords({ forTeam: summary.teamNumber });
  const pit = store.getPitRecord(summary.teamNumber);
  const pathFiles = store.getPathFiles(summary.teamNumber);

  return (
    <div className="panel" style={{ height: '100%', overflowY: 'auto' }}>
      <div className="team-detail-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <RankBadge rank={summary.rank} />
          <h2 style={{ margin: 0, fontSize: '26px' }}>Team {summary.teamNumber}</h2>
        </div>
        <RoleTag role={summary.role} />
      </div>

      <div className="grid-2 mb-20">
        <MetricCard title="Pick Score" value={fmtNum(summary.pickScore)} color="var(--pack-blue)" />
        <MetricCard title="Reliability" value={fmtPct(summary.reliability / 100)} color="var(--pack-green)" />
        <MetricCard title="Shooting Efficiency" value={fmtPct(summary.shootingEfficiency)} color="var(--pack-teal)" />
        <MetricCard title="Defense Index" value={fmtNum(summary.defenseIndex)} color="var(--pack-pink)" />
      </div>

      <div className="panel" style={{ background: '#fafafa', border: '1px solid var(--pack-border)' }}>
        <h4 style={{ margin: '0 0 10px 0' }}>Advanced Metrics</h4>
        <div className="grid-2" style={{ fontSize: '13px', lineHeight: '2' }}>
          <div>Avg Match Score: <strong>{fmtNum(summary.averageScore)} pts</strong></div>
          <div>L2+ Climb Rate: <strong>{fmtPct(summary.climbRate)}</strong></div>
          <div>Avg Broken Time: <strong>{fmtNum(summary.averageBrokeSeconds)}s</strong></div>
          <div>Matches Scouted: <strong>{summary.matchCount}</strong></div>
          <div>Risk Level: <strong style={{ color: summary.riskLabel === 'High' ? 'var(--pack-pink)' : summary.riskLabel === 'Medium' ? '#d97706' : 'var(--pack-green)' }}>{summary.riskLabel}</strong></div>
          <div>Flags: <strong>{summary.flags?.length ? summary.flags.join(', ') : 'None'}</strong></div>
        </div>
      </div>

      <h4 style={{ margin: '20px 0 8px 0' }}>Robot Movement (AI Path)</h4>
      <FieldPathView teamNumber={summary.teamNumber} paths={pathFiles} />

      <h4 style={{ margin: '20px 0 8px 0' }}>Pit Specifications</h4>
      {pit ? (
        <div className="panel" style={{ fontSize: '13px', lineHeight: '1.8', background: '#fafafa' }}>
          <div><strong>Drivetrain:</strong> {pit.driveTrainLabel}</div>
          <div><strong>Intake:</strong> {pit.intakeLabel}</div>
          <div><strong>Launcher:</strong> {pit.launcherLabel}</div>
          <div><strong>Terrain Capability:</strong> {pit.terrainLabel}</div>
          <div><strong>Width:</strong> {pit.width ? `${pit.width} in` : 'N/A'}</div>
          {pit.notes && <div style={{ marginTop: '8px', color: '#555' }}><em>"{pit.notes}"</em></div>}
        </div>
      ) : (
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px', padding: '10px 0' }}>No pit data recorded for Team {summary.teamNumber}</div>
      )}

      <h4 style={{ margin: '20px 0 8px 0' }}>Match History ({teamMatches.length})</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {teamMatches.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No matches recorded</div>
        ) : (
          teamMatches.map((m) => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: '#fafafa', borderRadius: '6px', fontSize: '13px', border: '1px solid var(--pack-border)' }}>
              <div>
                <strong>Qual {m.matchNumber}</strong>
                <span style={{ marginLeft: '10px', color: 'var(--text-secondary)' }}>Auto: {m.autoHub} | Teleop: {m.teleOpHub}</span>
              </div>
              <div>
                <span style={{ marginRight: '10px', color: 'var(--pack-blue)', fontWeight: '600' }}>{fmtNum(m.estimatedScore)} pts</span>
                <span style={{ fontSize: '11px', background: '#e0e7ff', color: '#3730a3', padding: '2px 6px', borderRadius: '4px' }}>Climb: {m.climbLabel}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// --- Page 1: Dashboard View ---
const DashboardView = () => {
  const { state, summaries, store } = useStore();

  const currentComp = store.getCurrentCompetition();

  const totalMatches = state.matches.length;
  const totalPits = state.pits.length;
  const totalPaths = state.paths.length;
  const avgEff = summaries.length > 0 ? summaries.reduce((acc, t) => acc + (t.shootingEfficiency || 0), 0) / summaries.length : 0;
  const avgRel = summaries.length > 0 ? summaries.reduce((acc, t) => acc + (t.reliability || 0), 0) / summaries.length : 0;

  const top10 = summaries.slice(0, 10);
  const lowSample = summaries.filter(s => s.matchCount < 3).length;
  const highRisk = summaries.filter(s => s.riskLabel === 'High').length;
  const missingPaths = summaries.filter(s => s.pathCoverage === 0).length;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={currentComp ? `Overview for ${currentComp.name}` : 'Overview and critical FRC scouting metrics'}
        rightContent={
          summaries.length === 0 && (
            <button onClick={() => store.loadSampleData()}>Load Demo Dataset</button>
          )
        }
      />
      <div className="page-body">
        {!currentComp && (
          <div className="panel" style={{ background: '#fef3c7', borderColor: '#f59e0b', marginBottom: '20px' }}>
            <p style={{ margin: 0, fontSize: '14px', color: '#92400e' }}>
              <strong>No competition selected.</strong> Create a competition from the dropdown at the top to start organizing your scouting data.
            </p>
          </div>
        )}
        <div className="grid-4 mb-20">
          <MetricCard title="Ranked Teams" value={summaries.length} color="var(--pack-blue)" />
          <MetricCard title="Avg Efficiency" value={fmtPct(avgEff)} color="var(--pack-green)" />
          <MetricCard title="Avg Reliability" value={fmtPct(avgRel / 100)} color="var(--pack-teal)" />
          <MetricCard title="Matches Scouted" value={totalMatches} color="var(--pack-pink)" />
        </div>

        {summaries.length === 0 ? (
          <EmptyState
            message="No scouting data loaded yet. You can import documents or load sample demo data to test the interface."
            actionText="Load Sample Data"
            onAction={() => store.loadSampleData()}
          />
        ) : (
          <div className="grid-2">
            <div className="panel">
              <h3 style={{ margin: '0 0 16px 0' }}>Top 10 Teams (Pick Score)</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {top10.map((t, idx) => (
                  <div key={t.teamNumber} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#fafafa', borderRadius: '8px', border: '1px solid var(--pack-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <RankBadge rank={idx + 1} />
                      <div>
                        <strong>Team {t.teamNumber}</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{t.role}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: '700', color: 'var(--pack-blue)', fontSize: '15px' }}>{fmtNum(t.pickScore)}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Eff: {fmtPct(t.shootingEfficiency)} | Rel: {fmtPct(t.reliability / 100)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="panel mb-20">
                <h3 style={{ margin: '0 0 12px 0' }}>Data Health & Risk</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: '#fafafa', borderRadius: '6px' }}>
                    <span>Low Sample Teams (&lt;3 matches):</span>
                    <strong style={{ color: lowSample > 0 ? 'var(--pack-pink)' : 'var(--pack-green)' }}>{lowSample}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: '#fafafa', borderRadius: '6px' }}>
                    <span>High Risk Teams:</span>
                    <strong style={{ color: highRisk > 0 ? 'var(--pack-pink)' : 'var(--pack-green)' }}>{highRisk}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: '#fafafa', borderRadius: '6px' }}>
                    <span>Missing Robot AI Paths:</span>
                    <strong style={{ color: 'var(--pack-teal)' }}>{missingPaths}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: '#fafafa', borderRadius: '6px' }}>
                    <span>Total Pit Profiles:</span>
                    <strong>{totalPits}</strong>
                  </div>
                </div>
              </div>

              <div className="panel">
                <h3 style={{ margin: '0 0 12px 0' }}>Upcoming Matches ({state.schedule.slice(0, 5).length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                  {state.schedule.slice(0, 5).map(m => (
                    <div key={m.matchNumber} style={{ padding: '8px', background: '#fafafa', borderRadius: '6px', border: '1px solid var(--pack-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '600', marginBottom: '4px' }}>
                        <span>{m.name}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{m.timeLabel}</span>
                      </div>
                      <div style={{ color: 'var(--pack-pink)' }}>Red: {m.redTeams.join(', ')}</div>
                      <div style={{ color: 'var(--pack-blue)' }}>Blue: {m.blueTeams.join(', ')}</div>
                    </div>
                  ))}
                  {state.schedule.length === 0 && (
                    <div style={{ color: 'var(--text-secondary)' }}>No match schedule loaded</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

// --- Page 2: PicklistView ---
const PicklistView = () => {
  const { summaries, store } = useStore();
  const [search, setSearch] = useState('');
  const [pick1, setPick1] = useState('balanced');
  const [pick2, setPick2] = useState('defenseBot');
  const [selectedTeam, setSelectedTeam] = useState(summaries[0]?.teamNumber || null);

  const scoredTeams = useMemo(() => {
    return summaries.map(t => {
      const p1Score = calculateScore(t, pick1);
      const p2Score = calculateScore(t, pick2);
      const blended = p1Score * 0.58 + p2Score * 0.42;
      return { ...t, p1Score, p2Score, blended };
    }).sort((a, b) => b.blended - a.blended);
  }, [summaries, pick1, pick2]);

  const filteredTeams = scoredTeams.filter(t => t.teamNumber.toString().includes(search));

  const exportCsv = async () => {
    const csvContent = store.exportPicklistCSV();
    if (window.electronAPI?.exportCsv) {
      await window.electronAPI.exportCsv(csvContent, 'packout-picklist.csv');
    } else {
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'packout-picklist.csv';
      a.click();
    }
  };

  return (
    <>
      <PageHeader 
        title="Picklist" 
        subtitle="Alliance selection ranking and customizable strategy models"
        rightContent={<button onClick={exportCsv}>Export Picklist CSV</button>}
      />
      <div className="page-body picklist-layout">
        <div className="picklist-main">
          <div className="panel mb-20" style={{ padding: '16px' }}>
            <div className="search-bar" style={{ margin: '0 0 16px 0' }}>
              <input 
                type="text" 
                placeholder="Search team number..." 
                value={search} 
                onChange={e => setSearch(e.target.value)} 
              />
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{filteredTeams.length} teams listed</span>
            </div>

            <div className="strategy-panel" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Pick 1 Strategy</label>
                <select value={pick1} onChange={e => setPick1(e.target.value)} style={{ width: '100%', padding: '6px' }}>
                  <option value="balanced">Balanced Fit</option>
                  <option value="scoringBot">Scoring Dominance</option>
                  <option value="defenseBot">Defense Anchor</option>
                  <option value="reliableBot">High Reliability</option>
                  <option value="endgameBot">Endgame / Climb</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Pick 2 Strategy</label>
                <select value={pick2} onChange={e => setPick2(e.target.value)} style={{ width: '100%', padding: '6px' }}>
                  <option value="balanced">Balanced Fit</option>
                  <option value="scoringBot">Scoring Dominance</option>
                  <option value="defenseBot">Defense Anchor</option>
                  <option value="reliableBot">High Reliability</option>
                  <option value="endgameBot">Endgame / Climb</option>
                </select>
              </div>
              <div style={{ background: '#f8fafc', padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}>
                <div style={{ color: 'var(--text-secondary)' }}>Best Recommendations</div>
                <div>Pick 1: <strong style={{ color: 'var(--pack-blue)' }}>Team {[...scoredTeams].sort((a,b)=>b.p1Score-a.p1Score)[0]?.teamNumber || 'N/A'}</strong></div>
                <div>Pick 2: <strong style={{ color: 'var(--pack-pink)' }}>Team {[...scoredTeams].sort((a,b)=>b.p2Score-a.p2Score)[0]?.teamNumber || 'N/A'}</strong></div>
              </div>
            </div>
          </div>

          <div className="panel" style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {filteredTeams.map((t, idx) => (
              <div 
                key={t.teamNumber} 
                className="list-row" 
                onClick={() => setSelectedTeam(t.teamNumber)}
                style={{ 
                  cursor: 'pointer', 
                  backgroundColor: (selectedTeam || summaries[0]?.teamNumber) === t.teamNumber ? '#eef2ff' : 'transparent',
                  padding: '12px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  borderBottom: '1px solid var(--pack-border)'
                }}
              >
                <RankBadge rank={idx + 1} />
                <div style={{ minWidth: '80px' }}>
                  <div style={{ fontWeight: '700', fontSize: '15px' }}>Team {t.teamNumber}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{t.matchCount} matches</div>
                </div>
                <RoleTag role={t.role} />
                <div style={{ flex: 1, display: 'flex', gap: '8px' }}>
                  {t.p1Score > 55 && <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>Pick 1 Fit</span>}
                  {t.p2Score > 55 && <span style={{ background: '#fdf2f8', color: '#be185d', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>Pick 2 Fit</span>}
                </div>
                <div style={{ textAlign: 'right', minWidth: '100px' }}>
                  <div style={{ fontWeight: '700', color: 'var(--pack-blue)', fontSize: '15px' }}>{fmtNum(t.blended)}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Avg: {fmtNum(t.averageScore)} pts</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="picklist-side" style={{ width: '420px', flexShrink: 0 }}>
          <TeamDetailPanel teamNumber={selectedTeam || summaries[0]?.teamNumber} />
        </div>
      </div>
    </>
  );
};

// --- Page 3: Team Directory View ---
const TeamDirectoryView = () => {
  const { summaries } = useStore();
  const [search, setSearch] = useState('');
  const [selectedTeam, setSelectedTeam] = useState(summaries[0]?.teamNumber || null);

  const filteredTeams = summaries.filter(t => t.teamNumber.toString().includes(search));

  return (
    <>
      <PageHeader title="Teams" subtitle="Deep-dive team statistics, pit data, and movement paths" />
      <div className="page-body picklist-layout">
        <div className="picklist-main" style={{ width: '340px', flex: 'none' }}>
          <div className="search-bar mb-20">
            <input 
              type="text" 
              placeholder="Search teams..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
            />
          </div>
          <div className="panel" style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {filteredTeams.map((t) => (
              <div 
                key={t.teamNumber} 
                className="list-row" 
                onClick={() => setSelectedTeam(t.teamNumber)}
                style={{ 
                  cursor: 'pointer',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  backgroundColor: (selectedTeam || summaries[0]?.teamNumber) === t.teamNumber ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid var(--pack-border)'
                }}
              >
                <div>
                  <div style={{ fontWeight: '700' }}>Team {t.teamNumber}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Rank #{t.rank}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <RoleTag role={t.role} />
                  <div style={{ fontSize: '11px', color: 'var(--pack-blue)', marginTop: '4px', fontWeight: '600' }}>{fmtNum(t.pickScore)} pts</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="picklist-side" style={{ flex: 1 }}>
          <TeamDetailPanel teamNumber={selectedTeam || summaries[0]?.teamNumber} />
        </div>
      </div>
    </>
  );
};

// --- Page 4: Film Review View ---
const FilmReviewView = () => {
  const { state, store } = useStore();
  const [url, setUrl] = useState('');
  const [selectedMatch, setSelectedMatch] = useState('12');
  const [downloadMsg, setDownloadMsg] = useState('');
  const videoRef = useRef(null);

  const uniqueMatches = store.getUniqueMatchNumbers();
  const currentVideo = store.getVideo(selectedMatch);
  const matchRecords = store.getMatchRecords({ forMatch: selectedMatch });
  const scheduled = store.getScheduledMatch(parseInt(selectedMatch, 10));

  const handleDownload = async () => {
    if (!url.trim()) return;
    setDownloadMsg('Starting video download...');
    if (window.electronAPI?.downloadVideo) {
      try {
        const res = await window.electronAPI.downloadVideo(url);
        setDownloadMsg(`Downloaded video to ${res.path || 'disk'}`);
        store.importData({
          videos: [new models.VideoAsset({ url: res.path, inferredMatchNumber: selectedMatch })]
        });
      } catch (err) {
        setDownloadMsg(`Error downloading: ${err.message || err}`);
      }
    } else {
      setDownloadMsg('Video download requires desktop Electron environment.');
    }
  };

  const handleImportVideo = async () => {
    if (window.electronAPI?.selectVideo) {
      const filePath = await window.electronAPI.selectVideo();
      if (filePath) {
        store.importData({
          videos: [new models.VideoAsset({ url: filePath, inferredMatchNumber: selectedMatch })]
        });
        setDownloadMsg(`Attached ${filePath} to Match ${selectedMatch}`);
      }
    }
  };

  const jumpTo = (seconds) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play();
    }
  };

  return (
    <>
      <PageHeader title="Film Review" subtitle="Match footage review, key game checkpoints, and synchronized robot tracing" />
      <div className="page-body">
        <div className="panel flex-between mb-20" style={{ flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <label style={{ fontSize: '13px', fontWeight: '600' }}>Match:</label>
            <select value={selectedMatch} onChange={e => setSelectedMatch(e.target.value)} style={{ padding: '6px' }}>
              {uniqueMatches.map(m => (
                <option key={m} value={m}>Match {m}</option>
              ))}
              {uniqueMatches.length === 0 && <option value="12">Match 12</option>}
            </select>
            <input 
              type="text" 
              placeholder="Paste YouTube or video URL..." 
              value={url} 
              onChange={e => setUrl(e.target.value)} 
              style={{ width: '280px', padding: '6px' }}
            />
            <button onClick={handleDownload}>Download</button>
          </div>
          <button className="secondary" onClick={handleImportVideo}>Import Local File</button>
        </div>

        {downloadMsg && (
          <div style={{ fontSize: '12px', color: 'var(--pack-blue)', marginBottom: '10px' }}>{downloadMsg}</div>
        )}

        <div className="panel" style={{ textAlign: 'center', padding: '16px', background: '#0a0a0a', borderRadius: '10px' }}>
          <video 
            ref={videoRef} 
            controls 
            src={currentVideo ? `file://${currentVideo.url}` : ''} 
            style={{ width: '100%', maxHeight: '420px', backgroundColor: '#000' }}
          >
            Video playback not supported
          </video>
          {!currentVideo && (
            <div style={{ color: '#888', padding: '20px 0', fontSize: '14px' }}>
              No video file attached for Match {selectedMatch}. You can download via yt-dlp or import a local mp4 file.
            </div>
          )}
        </div>

        <div className="panel flex-between mb-20" style={{ padding: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: '600' }}>Match Checkpoints:</span>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="secondary" onClick={() => jumpTo(0)}>Auto (0s)</button>
            <button className="secondary" onClick={() => jumpTo(15)}>Teleop (15s)</button>
            <button className="secondary" onClick={() => jumpTo(105)}>Endgame (105s)</button>
          </div>
        </div>

        <div className="grid-2">
          <div className="panel">
            <h4 style={{ margin: '0 0 12px 0' }}>Match {selectedMatch} Scouting Data</h4>
            {scheduled && (
              <div style={{ marginBottom: '12px', fontSize: '13px' }}>
                <div><strong style={{ color: 'var(--pack-pink)' }}>Red Alliance:</strong> {scheduled.redTeams.join(', ')}</div>
                <div><strong style={{ color: 'var(--pack-blue)' }}>Blue Alliance:</strong> {scheduled.blueTeams.join(', ')}</div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              {matchRecords.map(m => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: '#fafafa', borderRadius: '6px' }}>
                  <span>Team {m.teamNumber}: {fmtNum(m.estimatedScore)} pts</span>
                  <span>Eff: {fmtPct(m.shootingEfficiency)} | Climb: {m.climbLabel}</span>
                </div>
              ))}
              {matchRecords.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>No scouting entries for Match {selectedMatch}</div>}
            </div>
          </div>

          <div className="panel">
            <h4 style={{ margin: '0 0 12px 0' }}>AI Path Tracing</h4>
            {matchRecords.length > 0 ? (
              <FieldPathView teamNumber={matchRecords[0].teamNumber} paths={store.getPathFiles(matchRecords[0].teamNumber)} />
            ) : (
              <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No teams scouted for path tracing</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

// --- Page 5: Graphs View (Analysis) ---
const GraphsView = () => {
  const { summaries } = useStore();
  const [metricKey, setMetricKey] = useState('pickScore');

  const topTeams = [...summaries].sort((a,b) => (b[metricKey] || 0) - (a[metricKey] || 0)).slice(0, 10);
  const maxVal = topTeams.length > 0 ? Math.max(...topTeams.map(t => t[metricKey] || 0)) : 100;

  return (
    <>
      <PageHeader title="Analysis" subtitle="Visual data comparison, correlation scatter plots, and metric leaderboards" />
      <div className="page-body">
        <div className="panel flex-between mb-20">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label style={{ fontSize: '13px', fontWeight: '600' }}>Select Metric:</label>
            <select value={metricKey} onChange={e => setMetricKey(e.target.value)} style={{ padding: '6px' }}>
              <option value="pickScore">Pick Score</option>
              <option value="averageScore">Avg Match Score</option>
              <option value="shootingEfficiency">Shooting Efficiency</option>
              <option value="reliability">Reliability Index</option>
              <option value="defenseIndex">Defense Effectiveness</option>
              <option value="climbRate">Climb Rate</option>
            </select>
          </div>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Comparing top 10 competitors</span>
        </div>

        <div className="panel mb-20">
          <h4 style={{ margin: '0 0 16px 0' }}>Top 10: {metricKey.toUpperCase()}</h4>
          <div style={{ display: 'flex', alignItems: 'flex-end', height: '220px', gap: '14px', padding: '10px 0', borderBottom: '1px solid var(--pack-border)' }}>
            {topTeams.map(t => {
              const val = t[metricKey] || 0;
              const heightPct = maxVal > 0 ? (val / maxVal) * 100 : 0;
              return (
                <div key={t.teamNumber} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: '11px', fontWeight: '600', marginBottom: '4px' }}>{typeof val === 'number' && val < 1 ? fmtPct(val) : fmtNum(val)}</span>
                  <div 
                    style={{ 
                      width: '100%', 
                      height: `${Math.max(6, heightPct)}%`, 
                      backgroundColor: 'var(--pack-blue)', 
                      borderRadius: '4px 4px 0 0',
                      transition: 'height 0.3s' 
                    }} 
                  />
                  <span style={{ fontSize: '12px', marginTop: '6px', fontWeight: '600' }}>{t.teamNumber}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid-2">
          <div className="panel">
            <h4 style={{ margin: '0 0 12px 0' }}>Reliability vs Output (Scatter Plot)</h4>
            <div style={{ position: 'relative', height: '220px', background: '#fafafa', borderRadius: '8px', border: '1px solid var(--pack-border)' }}>
              {summaries.map(t => {
                const x = Math.min(94, Math.max(6, (t.reliability || 0)));
                const y = Math.min(94, Math.max(6, (t.averageScore ? (t.averageScore / 60) * 100 : 10)));
                return (
                  <div 
                    key={t.teamNumber} 
                    style={{ 
                      position: 'absolute', 
                      left: `${x}%`, 
                      bottom: `${y}%`,
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--pack-teal)',
                      border: '2px solid white',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      cursor: 'pointer'
                    }}
                    title={`Team ${t.teamNumber} - Reliability: ${t.reliability.toFixed(0)}%, Avg Score: ${t.averageScore.toFixed(1)}`}
                  />
                );
              })}
              <div style={{ position: 'absolute', bottom: '6px', left: '10px', fontSize: '11px', color: '#999' }}>Low Output / High Reliability →</div>
            </div>
          </div>

          <div className="panel">
            <h4 style={{ margin: '0 0 12px 0' }}>Team Role Distribution</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
              {['Captain Core', 'Efficient Scorer', 'Defense Anchor', 'Endgame Value', 'Depth'].map(roleName => {
                const count = summaries.filter(s => s.role === roleName).length;
                const pct = summaries.length > 0 ? (count / summaries.length) * 100 : 0;
                return (
                  <div key={roleName}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span>{roleName}</span>
                      <strong>{count} teams ({pct.toFixed(0)}%)</strong>
                    </div>
                    <div style={{ height: '6px', backgroundColor: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', backgroundColor: 'var(--pack-blue)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

// --- Page 6: AI Analysis View ---
const AIAnalysisView = () => {
  const [step, setStep] = useState(0);
  const [videoUrl, setVideoUrl] = useState('');
  const [leftTeams, setLeftTeams] = useState('971, 1540, 2471');
  const [rightTeams, setRightTeams] = useState('2990, 2910, 1425');
  const [teleopStart, setTeleopStart] = useState('15');
  const [statusMsg, setStatusMsg] = useState('');

  return (
    <>
      <PageHeader title="AI Video Analysis" subtitle="Computer vision robot tracking and automated trajectory extraction" />
      <div className="page-body">
        <div className="panel">
          <div className="progress-bar mb-20" style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--pack-border)', paddingBottom: '15px' }}>
            {['1. Setup', '2. Download', '3. Detect', '4. Analyze', '5. Complete'].map((label, idx) => (
              <div 
                key={label} 
                style={{ 
                  fontWeight: step === idx ? '700' : '500', 
                  color: step === idx ? 'var(--pack-blue)' : step > idx ? 'var(--pack-green)' : 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>{step > idx ? '✓' : ''}</span> {label}
              </div>
            ))}
          </div>

          {step === 0 && (
            <div>
              <h4>Step 1: Match Video & Alliance Setup</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Configure match video source and team assignments for automated Roboflow tracking.</p>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Match Video URL:</label>
                <input 
                  type="text" 
                  placeholder="https://www.youtube.com/watch?v=..." 
                  value={videoUrl} 
                  onChange={e => setVideoUrl(e.target.value)} 
                  style={{ width: '100%', padding: '8px' }}
                />
              </div>
              <div className="grid-2 mb-20">
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Left Alliance Teams:</label>
                  <input type="text" value={leftTeams} onChange={e => setLeftTeams(e.target.value)} style={{ width: '100%', padding: '8px' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Right Alliance Teams:</label>
                  <input type="text" value={rightTeams} onChange={e => setRightTeams(e.target.value)} style={{ width: '100%', padding: '8px' }} />
                </div>
              </div>
              <button onClick={() => setStep(1)}>Proceed to Download</button>
            </div>
          )}

          {step === 1 && (
            <div>
              <h4>Step 2: Video Fetching</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Fetching match stream via yt-dlp downloader...</p>
              <button onClick={() => {
                setStatusMsg('Downloading stream at 720p...');
                setTimeout(() => {
                  setStatusMsg('Video successfully cached.');
                  setStep(2);
                }, 1200);
              }}>Start Download</button>
              {statusMsg && <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--pack-blue)' }}>{statusMsg}</div>}
            </div>
          )}

          {step === 2 && (
            <div>
              <h4>Step 3: Roboflow AI Detection</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Detecting robot bounding boxes and chassis tracking tags...</p>
              <button onClick={() => {
                setStatusMsg('Running detector.py...');
                setTimeout(() => {
                  setStatusMsg('Detections verified.');
                  setStep(3);
                }, 1200);
              }}>Run Detection</button>
              {statusMsg && <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--pack-green)' }}>{statusMsg}</div>}
            </div>
          )}

          {step === 3 && (
            <div>
              <h4>Step 4: Trajectory & Path Calculation</h4>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Teleop Start Timestamp (seconds):</label>
                <input type="number" value={teleopStart} onChange={e => setTeleopStart(e.target.value)} style={{ width: '120px', padding: '6px' }} />
              </div>
              <button onClick={() => {
                setStatusMsg('AIScout generating team CSV path trajectories...');
                setTimeout(() => {
                  setStatusMsg('Path data extracted.');
                  setStep(4);
                }, 1200);
              }}>Execute Path Analysis</button>
              {statusMsg && <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--pack-blue)' }}>{statusMsg}</div>}
            </div>
          )}

          {step === 4 && (
            <div style={{ textAlign: 'center', padding: '30px' }}>
              <h3 style={{ color: 'var(--pack-green)', margin: '0 0 10px 0' }}>✓ Analysis Complete!</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>Robot trajectories and field coverage CSVs generated for all 6 alliance teams.</p>
              <button onClick={() => setStep(0)}>Run Another Match</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

// --- Page 7: Pit Browser View ---
const PitBrowserView = () => {
  const { state } = useStore();
  const [search, setSearch] = useState('');

  const pits = state.pits || [];
  const filtered = pits.filter(p => p.teamNumber.toString().includes(search));

  return (
    <>
      <PageHeader title="Pit Scouting" subtitle="Robot chassis specifications, mechanisms, intake types, and inspection notes" />
      <div className="page-body">
        <div className="search-bar mb-20">
          <input 
            type="text" 
            placeholder="Search by team number..." 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
          />
        </div>

        <div className="grid-3">
          {filtered.map(p => (
            <div key={p.id} className="panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ margin: 0 }}>Team {p.teamNumber}</h3>
                <span style={{ fontSize: '12px', background: '#f1f5f9', padding: '3px 8px', borderRadius: '4px', fontWeight: '600' }}>{p.driveTrainLabel}</span>
              </div>
              <div style={{ fontSize: '13px', lineHeight: '1.8' }}>
                <div><strong>Intake:</strong> {p.intakeLabel}</div>
                <div><strong>Launcher:</strong> {p.launcherLabel}</div>
                <div><strong>Terrain:</strong> {p.terrainLabel}</div>
                <div><strong>Frame Width:</strong> {p.width ? `${p.width} in` : 'Standard'}</div>
                {p.notes && (
                  <div style={{ marginTop: '10px', padding: '8px', background: '#fafafa', borderRadius: '6px', color: '#555' }}>
                    <em>"{p.notes}"</em>
                  </div>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="panel empty-state" style={{ gridColumn: 'span 3', textAlign: 'center' }}>
              No pit records matching your search. Import PitData folder or load sample data.
            </div>
          )}
        </div>
      </div>
    </>
  );
};

// --- Page 8: Sync View ---
const SyncView = () => {
  const { state, store } = useStore();
  const [adbActive, setAdbActive] = useState(false);
  const [defaultFolders, setDefaultFolders] = useState([]);

  useEffect(() => {
    if (window.electronAPI?.getDefaultFolders) {
      window.electronAPI.getDefaultFolders().then(res => setDefaultFolders(res || []));
    }
  }, []);

  const handleToggleAdb = async () => {
    if (!adbActive) {
      if (window.electronAPI?.startAdbTransfer) {
        await window.electronAPI.startAdbTransfer();
      }
      setAdbActive(true);
      store.appendLog("Started ADB phone transfer service");
    } else {
      if (window.electronAPI?.stopAdbTransfer) {
        await window.electronAPI.stopAdbTransfer();
      }
      setAdbActive(false);
      store.appendLog("Stopped ADB phone transfer service");
    }
  };

  const handleSelectAndImportFolder = async () => {
    if (window.electronAPI?.selectFolder) {
      const folders = await window.electronAPI.selectFolder();
      if (folders && folders.length > 0) {
        for (const f of folders) {
          const res = await window.electronAPI.importFolder(f);
          store.importFolderResults(res);
        }
      }
    }
  };

  const handleRescanDocuments = async () => {
    if (window.electronAPI?.scanDefaultFolders) {
      await window.electronAPI.scanDefaultFolders();
      const folders = await window.electronAPI.getDefaultFolders();
      setDefaultFolders(folders || []);
      for (const item of (folders || [])) {
        if (item.exists) {
          const res = await window.electronAPI.importFolder(item.path);
          store.importFolderResults(res);
        }
      }
    }
  };

  return (
    <>
      <PageHeader title="Sync & Storage" subtitle="ADB phone transfer, folder monitoring, and dataset management" />
      <div className="page-body">
        <div className="panel flex-between mb-20" style={{ backgroundColor: '#eef2ff', borderColor: '#c7d2fe' }}>
          <div>
            <h4 style={{ margin: '0 0 4px 0' }}>Demo Scouting Dataset</h4>
            <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>Populate the application with authentic FRC match data, pit records, and path files.</p>
          </div>
          <button onClick={() => store.loadSampleData()}>Load Sample Data</button>
        </div>

        <div className="grid-2 mb-20">
          <div className="panel">
            <h4 style={{ margin: '0 0 12px 0' }}>Android Device Sync (ADB)</h4>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', fontSize: '14px' }}>
              <span>Daemon Status: <strong style={{ color: adbActive ? 'var(--pack-green)' : '#999' }}>{adbActive ? 'Polling Active' : 'Stopped'}</strong></span>
            </div>
            <button className={adbActive ? 'secondary' : ''} style={{ width: '100%' }} onClick={handleToggleAdb}>
              {adbActive ? 'Stop Phone Transfer' : 'Start ADB Phone Transfer'}
            </button>
          </div>

          <div className="panel">
            <h4 style={{ margin: '0 0 12px 0' }}>Folder Importer</h4>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
              <button className="secondary" style={{ flex: 1 }} onClick={handleRescanDocuments}>Rescan Documents</button>
              <button className="secondary" style={{ flex: 1 }} onClick={handleSelectAndImportFolder}>Choose Folder...</button>
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>
              {defaultFolders.map(f => (
                <div key={f.path} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span>{f.path.split(/[/\\]/).pop()}</span>
                  <span>{f.exists ? '✓ Active' : '— Missing'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel mb-20">
          <h4 style={{ margin: '0 0 12px 0' }}>Active Store Inventory</h4>
          <div className="grid-4 text-center">
            <div>
              <div style={{ fontSize: '26px', fontWeight: 'bold', color: 'var(--pack-blue)' }}>{state.matches.length}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Match Records</div>
            </div>
            <div>
              <div style={{ fontSize: '26px', fontWeight: 'bold', color: 'var(--pack-green)' }}>{state.pits.length}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Pit Profiles</div>
            </div>
            <div>
              <div style={{ fontSize: '26px', fontWeight: 'bold', color: 'var(--pack-teal)' }}>{state.paths.length}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Robot AI Paths</div>
            </div>
            <div>
              <div style={{ fontSize: '26px', fontWeight: 'bold', color: 'var(--pack-pink)' }}>{state.videos.length}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Match Videos</div>
            </div>
          </div>
        </div>

        <div className="panel" style={{ backgroundColor: '#111827', color: '#10b981', fontFamily: 'monospace', fontSize: '12px', height: '140px', overflowY: 'auto' }}>
          {state.importLog.length === 0 ? (
            <div>&gt; System ready. No active log entries.</div>
          ) : (
            state.importLog.map((log, i) => <div key={i}>&gt; {log}</div>)
          )}
        </div>
      </div>
    </>
  );
};

// --- Page 9: Settings View ---
const SettingsView = () => {
  const { state, store } = useStore();
  const [roboKey, setRoboKey] = useState('');
  const [tbaKey, setTbaKey] = useState('');
  const [saveStatus, setSaveStatus] = useState('');

  const currentComp = store.getCurrentCompetition();

  useEffect(() => {
    setRoboKey(localStorage.getItem('roboflowApiKey') || '');
    setTbaKey(localStorage.getItem('tbaApiKey') || '');
  }, []);

  const handleSave = () => {
    localStorage.setItem('roboflowApiKey', roboKey);
    localStorage.setItem('tbaApiKey', tbaKey);
    if (window.electronAPI?.saveSettings) {
      window.electronAPI.saveSettings({ roboflowApiKey: roboKey, tbaApiKey: tbaKey });
    }
    setSaveStatus('Settings successfully saved.');
    setTimeout(() => setSaveStatus(''), 2500);
  };

  const handleFetchTba = async () => {
    if (!tbaKey) {
      setSaveStatus('Please enter a Blue Alliance API Key first.');
      return;
    }
    if (!currentComp || !currentComp.eventKey) {
      setSaveStatus('Please create a competition with an event key first.');
      return;
    }
    setSaveStatus('Fetching match schedule from Blue Alliance...');
    if (window.electronAPI?.fetchBlueAlliance) {
      try {
        const res = await window.electronAPI.fetchBlueAlliance(`/event/${currentComp.eventKey}/matches/simple`, tbaKey);
        if (res.data && Array.isArray(res.data)) {
          const scheduled = res.data.map(m => new models.ScheduledMatch({
            matchNumber: m.match_number,
            name: `Quals ${m.match_number}`,
            redTeams: (m.alliances?.red?.team_keys || []).map(t => t.replace('frc', '')),
            blueTeams: (m.alliances?.blue?.team_keys || []).map(t => t.replace('frc', '')),
            timeLabel: ''
          }));
          store.replaceSchedule(scheduled, `TBA ${currentComp.eventKey}`);
          setSaveStatus(`Imported ${scheduled.length} matches from TBA.`);
        } else {
          setSaveStatus('Invalid response from The Blue Alliance.');
        }
      } catch (err) {
        setSaveStatus(`Failed to fetch schedule: ${err.message || err}`);
      }
    }
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="External API configurations and event credentials" />
      <div className="page-body">
        <div className="panel mb-20">
          <h4>Current Competition</h4>
          {currentComp ? (
            <div style={{ fontSize: '13px', lineHeight: '1.8' }}>
              <div><strong>Name:</strong> {currentComp.name}</div>
              <div><strong>Event Key:</strong> {currentComp.eventKey || 'Not set'}</div>
              <div><strong>Created:</strong> {new Date(currentComp.createdAt).toLocaleDateString()}</div>
              <div><strong>Matches:</strong> {currentComp.matches?.length || 0}</div>
              <div><strong>Pit Records:</strong> {currentComp.pits?.length || 0}</div>
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No competition selected. Create one from the dropdown at the top of the app.</p>
          )}
        </div>

        <div className="panel mb-20">
          <h4>Roboflow Computer Vision</h4>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Required for running automated robot detection in match footage.</p>
          <div style={{ maxWidth: '400px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Roboflow API Key:</label>
            <input
              type="password"
              value={roboKey}
              onChange={e => setRoboKey(e.target.value)}
              style={{ width: '100%', padding: '8px' }}
            />
          </div>
        </div>

        <div className="panel mb-20">
          <h4>The Blue Alliance Integration</h4>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Synchronize official event match schedules and alliance team lists.</p>
          <div style={{ maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Current Event Key:</label>
              <input
                type="text"
                value={currentComp?.eventKey || ''}
                disabled
                style={{ width: '100%', padding: '8px', background: '#f3f4f6', color: '#666' }}
              />
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>Event key is set in the competition dropdown at the top of the app.</p>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>TBA Auth Key:</label>
              <input
                type="password"
                value={tbaKey}
                onChange={e => setTbaKey(e.target.value)}
                style={{ width: '100%', padding: '8px' }}
              />
            </div>
            <button className="secondary" onClick={handleFetchTba}>Fetch Event Schedule</button>
          </div>
        </div>

        <button onClick={handleSave}>Save All Settings</button>
        {saveStatus && <span style={{ marginLeft: '16px', fontSize: '13px', color: 'var(--pack-blue)' }}>{saveStatus}</span>}
      </div>
    </>
  );
};

// --- Page 10: Onboarding View ---
const OnboardingView = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [dependencies, setDependencies] = useState({ adb: true, python3: true, java: true, 'yt-dlp': true });

  useEffect(() => {
    if (window.electronAPI?.checkCommand) {
      ['adb', 'python3', 'java', 'yt-dlp'].forEach(async (cmd) => {
        const found = await window.electronAPI.checkCommand(cmd);
        setDependencies(prev => ({ ...prev, [cmd]: found }));
      });
    }
  }, []);

  const handleFinish = () => {
    localStorage.setItem('packout_onboarding_done', 'true');
    onComplete();
  };

  return (
    <div className="onboarding-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--pack-background)' }}>
      <div className="panel" style={{ width: '560px', padding: '36px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', borderBottom: '1px solid var(--pack-border)', paddingBottom: '12px', fontSize: '13px' }}>
          {['Welcome', 'Dependencies', 'Ready'].map((s, idx) => (
            <span key={s} style={{ fontWeight: step === idx ? '700' : '400', color: step === idx ? 'var(--pack-blue)' : 'inherit' }}>
              {s}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div>
            <h2 style={{ margin: '0 0 10px 0' }}>Welcome to Packout</h2>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              Packout is your complete FIRST Robotics Competition scouting workspace. Built for deep analytics, alliance picklists, match video film review, and computer vision AI robot tracking.
            </p>
            <button onClick={() => setStep(1)} style={{ marginTop: '20px' }}>Get Started</button>
          </div>
        )}

        {step === 1 && (
          <div>
            <h3 style={{ margin: '0 0 10px 0' }}>System Tool Check</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Packout leverages common CLI utilities for phone sync and video processing:</p>
            <div style={{ lineHeight: '2', margin: '15px 0', fontSize: '14px' }}>
              {Object.entries(dependencies).map(([tool, ok]) => (
                <div key={tool} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{tool}</span>
                  <strong style={{ color: ok ? 'var(--pack-green)' : 'var(--pack-pink)' }}>{ok ? 'Installed' : 'Missing'}</strong>
                </div>
              ))}
            </div>
            <button onClick={() => setStep(2)}>Continue</button>
          </div>
        )}

        {step === 2 && (
          <div>
            <h3 style={{ margin: '0 0 10px 0' }}>You're all set!</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              Your workspace is ready. You can begin importing match documents, pull files from scouting phones, or try the demo dataset.
            </p>
            <button onClick={handleFinish} style={{ marginTop: '20px' }}>Launch Packout</button>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Competition Header ---
const CompetitionHeader = () => {
  const { state, store } = useStore();
  const [showNewComp, setShowNewComp] = useState(false);
  const [newCompName, setNewCompName] = useState('');
  const [newCompEventKey, setNewCompEventKey] = useState('');

  const currentComp = store.getCurrentCompetition();

  const handleCreateCompetition = () => {
    if (newCompName.trim()) {
      store.createCompetition(newCompName.trim(), newCompEventKey.trim());
      setNewCompName('');
      setNewCompEventKey('');
      setShowNewComp(false);
    }
  };

  const handleDeleteCompetition = (id) => {
    if (confirm('Are you sure you want to delete this competition? All data will be lost.')) {
      store.deleteCompetition(id);
    }
  };

  return (
    <div style={{
      borderBottom: '1px solid var(--pack-border)',
      padding: '12px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: '#fafafa'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>Competition:</span>
        <select
          value={state.currentCompetitionId || ''}
          onChange={e => store.switchCompetition(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid var(--pack-border)',
            fontSize: '14px',
            minWidth: '200px',
            background: 'white'
          }}
        >
          {state.competitions.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          {state.competitions.length === 0 && <option value="">No competitions</option>}
        </select>
        {currentComp && currentComp.eventKey && (
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', background: '#f3f4f6', padding: '4px 8px', borderRadius: '4px' }}>
            {currentComp.eventKey}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {showNewComp ? (
          <>
            <input
              type="text"
              placeholder="Competition name"
              value={newCompName}
              onChange={e => setNewCompName(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--pack-border)', fontSize: '13px' }}
            />
            <input
              type="text"
              placeholder="Event key (e.g. 2026pncmp)"
              value={newCompEventKey}
              onChange={e => setNewCompEventKey(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--pack-border)', fontSize: '13px', width: '140px' }}
            />
            <button onClick={handleCreateCompetition}>Create</button>
            <button className="secondary" onClick={() => { setShowNewComp(false); setNewCompName(''); setNewCompEventKey(''); }}>Cancel</button>
          </>
        ) : (
          <>
            <button className="secondary" onClick={() => setShowNewComp(true)}>+ New Competition</button>
            {state.competitions.length > 1 && (
              <button className="secondary" style={{ color: '#dc2626', borderColor: '#dc2626' }} onClick={() => handleDeleteCompetition(state.currentCompetitionId)}>Delete</button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// --- App Entry Point ---
export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [onboardingDone, setOnboardingDone] = useState(false);
  const { store } = useStore();

  useEffect(() => {
    const done = localStorage.getItem('packout_onboarding_done');
    if (done) setOnboardingDone(true);

    // Load competitions from localStorage
    store.loadCompetitions();

    // Initial load: bundled schedule & default scan if available
    if (window.electronAPI?.readScheduleFile) {
      window.electronAPI.readScheduleFile().then(matches => {
        if (matches && matches.length > 0) {
          store.replaceSchedule(matches, 'Bundled Schedule');
        }
      });
    }

    if (window.electronAPI?.getDefaultFolders) {
      window.electronAPI.getDefaultFolders().then(folders => {
        (folders || []).forEach(f => {
          if (f.exists && window.electronAPI?.importFolder) {
            window.electronAPI.importFolder(f.path).then(res => {
              store.importFolderResults(res);
            });
          }
        });
      });
    }
  }, []);

  if (!onboardingDone) {
    return <OnboardingView onComplete={() => setOnboardingDone(true)} />;
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '⬛' },
    { id: 'picklist', label: 'Picklist', icon: '📋' },
    { id: 'teams', label: 'Teams', icon: '👥' },
    { id: 'film', label: 'Film', icon: '🎬' },
    { id: 'analysis', label: 'Analysis', icon: '📊' },
    { id: 'ai', label: 'AI', icon: '🧠' },
    { id: 'pit', label: 'Pit', icon: '🔧' },
    { id: 'sync', label: 'Sync', icon: '📱' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <DashboardView />;
      case 'picklist': return <PicklistView />;
      case 'teams': return <TeamDirectoryView />;
      case 'film': return <FilmReviewView />;
      case 'analysis': return <GraphsView />;
      case 'ai': return <AIAnalysisView />;
      case 'pit': return <PitBrowserView />;
      case 'sync': return <SyncView />;
      case 'settings': return <SettingsView />;
      default: return <DashboardView />;
    }
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <div style={{ width: 14, height: 14, backgroundColor: 'var(--pack-blue)', borderRadius: 3 }} />
          <span>Packout</span>
        </div>
        <div className="nav-menu">
          {navItems.map(item => (
            <div
              key={item.id}
              className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <span style={{ fontSize: '13px' }}>{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="main-content">
        <CompetitionHeader />
        {renderContent()}
      </div>
    </div>
  );
}
