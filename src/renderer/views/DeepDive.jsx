import React, { useMemo, useState } from 'react';
import { getSummaries, store, useApp, useCurrent } from '../store';
import { Badge, Button, Card, Empty, Icon, RankBadge, RiskTag, RoleTag, SearchInput, fmt, pct } from '../components/ui';
import { AnimatedValue } from '../components/ui';
import { Distribution, LineChart, Radar, StackedBars } from '../components/charts';
import { PathExplorer } from '../components/TeamDetail';
import { METRICS, buildField, insights } from '../../shared/deepstats';
import { climbLabel, naturalNumber } from '../../shared/models';

let fieldCache = { m: null, p: null, s: null, v: null };
/** League-wide profiles + percentiles, recomputed only when the data changes. */
function getField(comp, summaries) {
  if (fieldCache.m === comp.matches && fieldCache.p === comp.paths && fieldCache.s === summaries) return fieldCache.v;
  fieldCache = { m: comp.matches, p: comp.paths, s: summaries, v: buildField(comp.matches, comp.paths, summaries) };
  return fieldCache.v;
}

const RADAR_AXES = ['Scoring', 'Auto', 'Accuracy', 'Endgame', 'Reliability', 'Defense'];
const SERIES_COLORS = ['#6d83ff', '#34d399', '#f59e0b', '#f472b6'];
const POINT_KEYS = [
  { key: 'auto', label: 'Auto', color: '#f472b6' },
  { key: 'tele', label: 'Teleop fuel', color: '#6d83ff' },
  { key: 'pass', label: 'Passing', color: '#22d3ee' },
  { key: 'climb', label: 'Climb', color: '#f59e0b' },
];

const fmtMetric = (m, v) => (m.pct ? pct(v) : `${fmt(v, 1)}${m.unit === '/5' ? '/5' : ''}`);
const topLabel = (p) => (p >= 50 ? `Top ${Math.max(1, Math.round(100 - p))}%` : `Bottom ${Math.max(1, Math.round(p))}%`);

function MetricRow({ metric, rank }) {
  const tone = rank.pct >= 66 ? 'good' : rank.pct <= 33 ? 'bad' : 'mid';
  return (
    <div className="metric-row">
      <div className="metric-row-top">
        <span>{metric.label}</span>
        <strong><AnimatedValue value={fmtMetric(metric, rank.value)} /></strong>
      </div>
      <div className="pct-track" title={`${Math.round(rank.pct)}th percentile`}>
        <span className={`pct-fill ${tone}`} style={{ width: `${Math.max(3, rank.pct)}%` }} />
      </div>
      <div className="metric-row-sub"><span className={`pct-label ${tone}`}>{topLabel(rank.pct)}</span><span>#{rank.rank} of {rank.of}</span></div>
    </div>
  );
}

function TeamPicker({ teams, value, onChange }) {
  const idx = teams.findIndex((t) => t.teamNumber === value);
  const step = (d) => onChange(teams[(idx + d + teams.length) % teams.length].teamNumber);
  return (
    <div className="row">
      <Button size="sm" variant="ghost" icon="arrowLeft" onClick={() => step(-1)} aria-label="Previous team" />
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Team">
        {teams.map((t) => <option key={t.teamNumber} value={t.teamNumber}>Team {t.teamNumber} · rank {t.rank}</option>)}
      </select>
      <Button size="sm" variant="ghost" icon="arrowRight" onClick={() => step(1)} aria-label="Next team" />
    </div>
  );
}

export default function DeepDive() {
  const comp = useCurrent();
  const { selectedTeam } = useApp();
  const summaries = getSummaries(comp);
  const field = getField(comp, summaries);
  const teams = summaries.filter((s) => field.profiles.get(s.teamNumber)?.matches > 0);
  const team = teams.find((t) => t.teamNumber === selectedTeam)?.teamNumber || teams[0]?.teamNumber;

  const profile = field.profiles.get(team);
  const rank = field.ranks.get(team);
  const summary = summaries.find((s) => s.teamNumber === team);
  const notes = useMemo(() => insights(profile, rank), [profile, rank]);

  if (!team) return <Card><Empty icon="users" title="No scouted teams yet" body="Deep dives need match records. Import scouting data or load the demo dataset." action={<Button variant="primary" onClick={() => store.loadSampleData()}>Load demo data</Button>} /></Card>;

  const pm = profile.perMatch;
  const lvl = profile.climb.levels;
  const mv = profile.movement;
  const runs = comp.paths.filter((p) => p.teamNumber === team);
  const trend = profile.form.slope;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Card>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div className="row" style={{ gap: 14 }}>
            <RankBadge rank={summary.rank} />
            <div>
              <h2 style={{ fontSize: 26, letterSpacing: '-0.02em' }}>Team {team}</h2>
              <div className="team-tags" style={{ marginTop: 6 }}>
                <RoleTag role={summary.role} /><RiskTag risk={summary.riskLabel} />
                <Badge>{profile.matches} match{profile.matches === 1 ? '' : 'es'}</Badge>
                {trend > 1.5 && <Badge tone="ok">↗ improving</Badge>}
                {trend < -1.5 && <Badge tone="danger">↘ declining</Badge>}
                {summary.flags.filter((f) => f !== 'Low sample').map((f) => <Badge key={f}>{f}</Badge>)}
              </div>
            </div>
          </div>
          <TeamPicker teams={teams} value={team} onChange={store.setSelectedTeam} />
        </div>
      </Card>

      <div className="grid-main">
        <div className="col">
          <Card title="Points by match" subtitle={`Best Q${profile.best.matchNumber} (${fmt(profile.best.points)}) · worst Q${profile.worst.matchNumber} (${fmt(profile.worst.points)}) · range ${fmt(profile.reliability.floor)}–${fmt(profile.reliability.ceiling)}`}>
            <StackedBars items={pm.map((m) => ({ label: `Q${m.matchNumber}`, parts: m }))} keys={POINT_KEYS} />
            <div className="mini-stats" style={{ marginTop: 14 }}>
              <div><span>Average</span><strong><AnimatedValue value={fmt(profile.avg.total)} /> pts</strong></div>
              <div><span>Median</span><strong>{fmt(profile.reliability.median)} pts</strong></div>
              <div><span>Last 3 vs avg</span><strong style={{ color: profile.form.vsAvg >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{profile.form.vsAvg >= 0 ? '+' : ''}{fmt(profile.form.vsAvg)}</strong></div>
            </div>
          </Card>

          <Card title="Scoring breakdown" subtitle="Where this robot's average points come from">
            <Distribution items={[
              { label: 'Autonomous', value: +profile.avg.auto.toFixed(1), tone: 'danger' },
              { label: 'Teleop fuel', value: +profile.avg.tele.toFixed(1), tone: 'accent' },
              { label: 'Passing', value: +profile.avg.pass.toFixed(1), tone: 'violet' },
              { label: 'Endgame climb', value: +profile.avg.climb.toFixed(1), tone: 'warn' },
            ]} />
          </Card>

          <Card title="Shooting" subtitle="Accuracy across matches (made ÷ attempted)">
            <LineChart points={pm.map((m) => ({ x: `Q${m.matchNumber}`, y: m.efficiency * 100 }))} yLabel="Accuracy %" />
            <div className="mini-stats" style={{ marginTop: 14 }}>
              <div><span>Auto accuracy</span><strong>{pct(profile.accuracy.auto)}</strong></div>
              <div><span>Teleop accuracy</span><strong>{pct(profile.accuracy.tele)}</strong></div>
              <div><span>Shots / match</span><strong>{fmt(profile.avg.shots)}</strong></div>
              <div><span>Auto fuel</span><strong>{fmt(profile.avg.autoFuel)}</strong></div>
              <div><span>Teleop fuel</span><strong>{fmt(profile.avg.teleFuel)}</strong></div>
              <div><span>Passes</span><strong>{fmt(profile.avg.passed)}</strong></div>
            </div>
          </Card>

          <Card title="Endgame" subtitle={`${profile.climb.successes} successful climb${profile.climb.successes === 1 ? '' : 's'} in ${profile.matches} matches`}>
            <Distribution items={[
              { label: 'Level 3', value: lvl.l3, tone: 'ok' },
              { label: 'Level 2', value: lvl.l2, tone: 'accent' },
              { label: 'Level 1', value: lvl.l1, tone: 'violet' },
              { label: 'Failed attempt', value: lvl.fail, tone: 'danger' },
              { label: 'No attempt', value: lvl.none, tone: 'neutral' },
            ]} />
            <div className="mini-stats" style={{ marginTop: 14 }}>
              <div><span>Attempt rate</span><strong>{pct(profile.climb.attemptRate)}</strong></div>
              <div><span>Success when trying</span><strong>{profile.climb.attempts ? pct(profile.climb.successRate) : '–'}</strong></div>
              <div><span>Auto climb rate</span><strong>{pct(profile.climb.autoRate)}</strong></div>
            </div>
          </Card>

          <Card title="Reliability & defense" subtitle="Downtime and time spent being defended, per match (seconds)">
            <StackedBars unit="s" height={200}
              items={pm.map((m) => ({ label: `Q${m.matchNumber}`, parts: { down: m.broke, def: m.underDef } }))}
              keys={[{ key: 'down', label: 'Robot down', color: '#ef4444' }, { key: 'def', label: 'Under defense', color: '#f59e0b' }]} />
            <div className="mini-stats" style={{ marginTop: 14 }}>
              <div><span>Uptime</span><strong>{pct(profile.reliability.uptime)}</strong></div>
              <div><span>Matches with downtime</span><strong>{pct(profile.reliability.downMatches)}</strong></div>
              <div><span>Avg downtime</span><strong>{fmt(profile.reliability.avgDown, 0)}s</strong></div>
              <div><span>Defense rating</span><strong>{fmt(profile.defense.rating)}/5</strong></div>
              <div><span>Time playing defense</span><strong>{fmt(profile.defense.time, 0)}s</strong></div>
              <div><span>When defended</span><strong style={{ color: profile.defense.defendedDelta === null ? undefined : profile.defense.defendedDelta >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{profile.defense.defendedDelta === null ? 'n/a' : `${profile.defense.defendedDelta >= 0 ? '+' : ''}${fmt(profile.defense.defendedDelta)} pts`}</strong></div>
            </div>
          </Card>

          <Card title="Movement (AI paths)" subtitle={mv ? `${mv.runs} tracked match${mv.runs === 1 ? '' : 'es'}` : 'Track this team in AI Trace to unlock this section'}>
            {mv ? (
              <>
                <div className="mini-stats" style={{ marginBottom: 14 }}>
                  <div><span>Distance / match</span><strong>{fmt(mv.avgDistance, 0)} m</strong></div>
                  <div><span>Average speed</span><strong>{fmt(mv.avgSpeed, 2)} m/s</strong></div>
                  <div><span>Time on own half</span><strong>{pct(mv.ownHalfShare)}</strong></div>
                </div>
                <PathExplorer runs={runs} />
              </>
            ) : <Empty icon="route" title="No path data" body="Run the AI tracer on a match video that includes this robot." action={<Button onClick={() => store.go('trace')}>Open AI Trace</Button>} />}
          </Card>

          <Card title="Match log" flush>
            <table className="table">
              <thead><tr><th>Match</th><th>Auto</th><th>Tele</th><th>Pass</th><th>Climb</th><th>Acc</th><th>Down</th><th className="num">Total</th></tr></thead>
              <tbody>
                {pm.map((m) => (
                  <tr key={m.matchNumber} className={m.matchNumber === profile.best.matchNumber ? 'row-best' : m.matchNumber === profile.worst.matchNumber && pm.length > 2 ? 'row-worst' : ''}>
                    <td><strong>Q{m.matchNumber}</strong></td>
                    <td>{fmt(m.auto)}</td><td>{fmt(m.tele)}</td><td>{fmt(m.pass)}</td><td>{climbLabel(m.climbLevel)}{m.climb ? ` · ${fmt(m.climb, 0)}` : ''}</td>
                    <td>{pct(m.efficiency)}</td><td>{m.broke ? `${m.broke}s` : '–'}</td><td className="num"><strong>{fmt(m.total)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="col sticky-col">
          <Card title="Field standing" subtitle={`Percentile among ${field.size} scouted teams`}>
            <Radar axes={RADAR_AXES} series={[{ name: `Team ${team}`, color: SERIES_COLORS[0], values: RADAR_AXES.map((a) => rank.radar[a]) }]} />
          </Card>
          <Card title="Strengths">
            {notes.strengths.length ? <ul className="insight-list good">{notes.strengths.map((t) => <li key={t}><Icon name="check" size={15} />{t}</li>)}</ul> : <p className="muted">No standout strengths yet — needs more matches or a bigger edge over the field.</p>}
          </Card>
          <Card title="Watch-outs">
            {notes.risks.length ? <ul className="insight-list bad">{notes.risks.map((t) => <li key={t}><Icon name="alert" size={15} />{t}</li>)}</ul> : <p className="muted">Nothing concerning in the data.</p>}
          </Card>
          <Card title="Metric ranks">
            <div className="metric-rows">{METRICS.map((m) => <MetricRow key={m.id} metric={m} rank={rank[m.id]} />)}</div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ compare ---

const COMPARE_ROWS = [
  ['Matches scouted', (p) => p.matches, (v) => v, true],
  ['Average points', (p) => p.avg.total, (v) => fmt(v), true],
  ['Autonomous points', (p) => p.avg.auto, (v) => fmt(v), true],
  ['Teleop fuel points', (p) => p.avg.tele, (v) => fmt(v), true],
  ['Shots per match', (p) => p.avg.shots, (v) => fmt(v), true],
  ['Accuracy', (p) => p.accuracy.overall, (v) => pct(v), true],
  ['Endgame points', (p) => p.avg.climb, (v) => fmt(v), true],
  ['Climb success rate', (p) => p.climb.rate, (v) => pct(v), true],
  ['Uptime', (p) => p.reliability.uptime, (v) => pct(v), true],
  ['Average downtime', (p) => p.reliability.avgDown, (v) => `${fmt(v, 0)}s`, false],
  ['Score floor', (p) => p.reliability.floor, (v) => fmt(v), true],
  ['Score ceiling', (p) => p.reliability.ceiling, (v) => fmt(v), true],
  ['Volatility (σ pts)', (p) => p.reliability.sd, (v) => fmt(v), false],
  ['Defense rating', (p) => p.defense.rating, (v) => `${fmt(v)}/5`, true],
];

export function Compare() {
  const comp = useCurrent();
  const { selectedTeam } = useApp();
  const summaries = getSummaries(comp);
  const field = getField(comp, summaries);
  const teams = summaries.filter((s) => field.profiles.get(s.teamNumber)?.matches > 0);
  const [picked, setPicked] = useState(() => {
    const start = [selectedTeam, ...teams.map((t) => t.teamNumber)].filter((t, i, a) => t && a.indexOf(t) === i && teams.some((x) => x.teamNumber === t));
    return start.slice(0, 3);
  });
  const [q, setQ] = useState('');
  const toggle = (t) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : p.length >= 4 ? p : [...p, t]));

  if (teams.length < 2) return <Card><Empty icon="users" title="Need at least two scouted teams" body="Import more scouting data or load the demo dataset to compare teams." action={<Button variant="primary" onClick={() => store.loadSampleData()}>Load demo data</Button>} /></Card>;

  const sel = picked.filter((t) => field.profiles.has(t));
  const list = [...teams].sort((a, b) => naturalNumber(a.teamNumber) - naturalNumber(b.teamNumber)).filter((t) => !q.trim() || t.teamNumber.includes(q.trim()));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Card title="Choose up to four teams" subtitle={`${sel.length} selected`} actions={<Button size="sm" variant="ghost" onClick={() => setPicked([])} disabled={!sel.length}>Clear</Button>}>
        <div className="stack">
          <SearchInput value={q} onChange={setQ} placeholder="Filter team numbers…" />
          <div className="pill-row" style={{ maxHeight: 110, overflowY: 'auto' }}>
            {list.map((t) => {
              const idx = sel.indexOf(t.teamNumber);
              return (
                <button key={t.teamNumber} type="button" className={`chip ${idx >= 0 ? 'on' : ''}`} onClick={() => toggle(t.teamNumber)} style={idx >= 0 ? { borderColor: SERIES_COLORS[idx], color: SERIES_COLORS[idx] } : null}>
                  {idx >= 0 && <i className="swatch" style={{ background: SERIES_COLORS[idx] }} />}{t.teamNumber}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {sel.length === 0 ? <Card><Empty icon="chart" title="Pick teams to compare" body="Select two to four teams above to overlay their strengths and see every number side by side." /></Card> : (
        <div className="grid-main" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)' }}>
          <Card title="Percentile profile" subtitle="Further from the center is better than more of the field">
            <Radar size={380} axes={RADAR_AXES} series={sel.map((t, i) => ({ name: `Team ${t}`, color: SERIES_COLORS[i], values: RADAR_AXES.map((a) => field.ranks.get(t).radar[a]) }))} />
            <div className="legend" style={{ justifyContent: 'center' }}>{sel.map((t, i) => <span key={t}><i style={{ background: SERIES_COLORS[i] }} /> Team {t}</span>)}</div>
          </Card>
          <Card title="Side by side" flush>
            <table className="table compare">
              <thead><tr><th>Metric</th>{sel.map((t, i) => <th key={t} className="num" style={{ color: SERIES_COLORS[i] }}>{t}</th>)}</tr></thead>
              <tbody>
                {COMPARE_ROWS.map(([label, get, show, higher]) => {
                  const vals = sel.map((t) => get(field.profiles.get(t)));
                  const best = higher ? Math.max(...vals) : Math.min(...vals);
                  return (
                    <tr key={label}>
                      <td>{label}</td>
                      {vals.map((v, i) => <td key={sel[i]} className={`num ${sel.length > 1 && v === best && vals.some((x) => x !== best) ? 'best-cell' : ''}`}>{show(v)}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
