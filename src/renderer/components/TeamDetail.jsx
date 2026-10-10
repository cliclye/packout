import React, { useMemo, useState } from 'react';
import { getSummaries, store, useCurrent } from '../store';
import { Badge, Card, Empty, RankBadge, RiskTag, RoleTag, Segmented, Stat, fmt, pct } from './ui';
import FieldView, { FieldLegend } from './FieldView';
import { LineChart } from './charts';
import { mediaUrl } from '../api';
import { estimatedScore, shootingEfficiency, climbLabel, pitLabels, byNatural } from '../../shared/models';
import { stddev } from '../../shared/analytics';

export function PathExplorer({ runs, height }) {
  const [mode, setMode] = useState('paths');
  const [filter, setFilter] = useState('both');
  const [side, setSide] = useState('both');
  const left = runs.filter((r) => r.samples[0] && r.samples[0].x < 0.5).length;
  return (
    <div className="path-explorer">
      <div className="path-controls">
        <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'paths', label: 'Paths' }, { value: 'heat', label: 'Heatmap' }]} />
        <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: 'both', label: 'All' }, { value: 'auto', label: 'Auto' }, { value: 'tele', label: 'Teleop' }]} />
        {runs.length > 1 && (
          <Segmented
            size="sm"
            value={side}
            onChange={setSide}
            options={[
              { value: 'both', label: `Both (${runs.length})` },
              { value: 'left', label: `Left (${left})` },
              { value: 'right', label: `Right (${runs.length - left})` },
            ]}
          />
        )}
      </div>
      <FieldView runs={runs} mode={mode} filter={filter} side={side} />
      <FieldLegend mode={mode} />
    </div>
  );
}

function PitPanel({ pit }) {
  const L = pitLabels(pit);
  const img = mediaUrl(pit.imagePath);
  return (
    <div className="pit-mini">
      <div className="pit-photo">{img ? <img src={img} alt={`Team ${pit.teamNumber} robot`} /> : <span>No photo</span>}</div>
      <div className="pit-specs">
        <dl>
          <dt>Drivetrain</dt><dd>{L.driveTrain}</dd>
          <dt>Intake</dt><dd>{L.intake}</dd>
          <dt>Launcher</dt><dd>{L.launcher}</dd>
          <dt>Terrain</dt><dd>{L.terrain}</dd>
          <dt>Width</dt><dd>{pit.width ? `${pit.width} in` : '–'}</dd>
        </dl>
        {pit.notes && <p className="quote">“{pit.notes}”</p>}
      </div>
    </div>
  );
}

export default function TeamDetail({ teamNumber }) {
  const comp = useCurrent();
  const summaries = getSummaries(comp);
  const summary = summaries.find((s) => s.teamNumber === teamNumber);

  const data = useMemo(() => {
    if (!comp || !summary) return null;
    const records = comp.matches.filter((m) => m.teamNumber === summary.teamNumber).sort((a, b) => byNatural(a.matchNumber, b.matchNumber));
    const pit = comp.pits
      .filter((p) => p.teamNumber === summary.teamNumber)
      .sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)))[0];
    const runs = comp.paths.filter((p) => p.teamNumber === summary.teamNumber);
    return { records, pit, runs };
  }, [comp, summary]);

  if (!summary || !data) {
    return <Empty icon="users" title="No team selected" body="Pick a team from the list to see its profile." />;
  }
  const { records, pit, runs } = data;
  const scores = records.map(estimatedScore);
  const consistency = Math.max(0, 100 - stddev(scores) * 5);
  const l2plus = records.length ? records.filter((m) => m.teleOpClimb >= 3).length / records.length : 0;
  const burden = records.length ? records.reduce((a, m) => a + m.underDefDuration, 0) / records.length : 0;
  const noted = records.length ? records.filter((m) => m.notes.trim()).length / records.length : 0;

  return (
    <div className="team-detail">
      <div className="team-head">
        <div>
          <div className="team-title">
            <RankBadge rank={summary.rank} />
            <h2>Team {summary.teamNumber}</h2>
          </div>
          <div className="team-tags">
            <RoleTag role={summary.role} />
            <RiskTag risk={summary.riskLabel} />
            {summary.flags.map((f) => <Badge key={f} tone="neutral">{f}</Badge>)}
          </div>
        </div>
        <button type="button" className="link-btn" onClick={() => { store.setSelectedTeam(summary.teamNumber); store.go('teams'); }}>
          Open in Teams →
        </button>
      </div>

      <div className="stat-grid two">
        <Stat label="Pick score" value={fmt(summary.pickScore)} hint={`rank ${summary.rank}`} tone="accent" />
        <Stat label="Reliability" value={fmt(summary.reliability, 0)} hint={`${summary.matchCount} matches`} tone="teal" />
        <Stat label="Efficiency" value={pct(summary.shootingEfficiency)} hint={`${fmt(summary.averageScore)} avg pts`} tone="ok" />
        <Stat label="Defense" value={fmt(summary.defenseIndex, 0)} hint={`${fmt(summary.averageBrokeSeconds, 0)}s avg down`} tone="pink" />
      </div>

      <Card title="Advanced profile">
        <div className="mini-stats">
          <div><span>Consistency</span><strong>{fmt(consistency, 0)}%</strong></div>
          <div><span>L2+ climb rate</span><strong>{pct(l2plus)}</strong></div>
          <div><span>Time under defense</span><strong>{fmt(burden, 0)}s</strong></div>
          <div><span>Notes coverage</span><strong>{pct(noted)}</strong></div>
          <div><span>Clutch index</span><strong>{fmt((summary.pickScore * summary.reliability) / 100, 1)}</strong></div>
          <div><span>Path samples</span><strong>{summary.pathCoverage}</strong></div>
        </div>
      </Card>

      {scores.length > 1 && (
        <Card title="Score by match" subtitle="Estimated points per match">
          <LineChart points={records.map((m) => ({ x: `M${m.matchNumber}`, y: estimatedScore(m) }))} yLabel="Estimated points" />
        </Card>
      )}

      <Card title="Robot movement" subtitle={runs.length ? `${runs.length} tracked match${runs.length === 1 ? '' : 'es'}` : 'AI path tracing'}>
        {runs.length ? (
          <PathExplorer runs={runs} />
        ) : (
          <Empty icon="route" title="No path data yet" body="Run the AI tracer on match video, or import path CSVs from Sync." action={<button type="button" className="link-btn" onClick={() => store.go('trace')}>Open AI Trace →</button>} />
        )}
      </Card>

      <Card title="Pit scouting">{pit ? <PitPanel pit={pit} /> : <p className="muted">No pit record for this team.</p>}</Card>

      <Card title={`Match history (${records.length})`} flush>
        {records.length === 0 ? (
          <p className="muted pad">No matches scouted.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Match</th><th>Auto</th><th>Tele</th><th>Eff</th><th>Climb</th><th>Down</th><th className="num">Pts</th></tr>
            </thead>
            <tbody>
              {records.map((m) => (
                <React.Fragment key={m.id}>
                  <tr>
                    <td><strong>Q{m.matchNumber}</strong></td>
                    <td>{m.autoHub}</td>
                    <td>{m.teleOpHub}</td>
                    <td>{pct(shootingEfficiency(m))}</td>
                    <td>{climbLabel(m.teleOpClimb)}</td>
                    <td>{m.brokeDuration ? `${m.brokeDuration}s` : '–'}</td>
                    <td className="num"><strong>{fmt(estimatedScore(m))}</strong></td>
                  </tr>
                  {m.notes.trim() && (
                    <tr className="note-row"><td colSpan="7">{m.notes}</td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
