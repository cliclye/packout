import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getSummaries, store, useApp, useCurrent } from '../store';
import { Badge, Button, Card, Empty, Icon, PageHeader, Segmented, Spinner, fmt, pct } from '../components/ui';
import FieldView, { FieldLegend } from '../components/FieldView';
import { TeamChip, WinBar } from './Event';
import { buildField } from '../../shared/deepstats';
import { fitModel, predictMatch } from '../../shared/predict';
import { buildGamePlan } from '../../shared/strategy';
import { clock, loadEvent, matchLabel, matchTime, played, relTime, sortMatches, teamNum } from '../lib/tbaLive';

const PHASES = ['Overall', 'Scouting', 'Defense', 'Auto', 'Teleop', 'Endgame', 'Risk'];
const PRIORITY = { high: { tone: 'danger', label: 'High priority' }, med: { tone: 'accent', label: 'Medium' }, low: { tone: 'neutral', label: 'Good to know' } };
const PHASE_ICON = { Overall: 'flag', Scouting: 'eye', Defense: 'crosshair', Auto: 'play', Teleop: 'sync', Endgame: 'trophy', Risk: 'alert' };

/** Stand-in TBA-shaped match objects built from the competition schedule (used when TBA isn't available). */
const fromSchedule = (schedule) =>
  schedule.map((s) => ({
    key: `sched_${s.matchNumber}`,
    comp_level: 'qm',
    set_number: 1,
    match_number: s.matchNumber,
    alliances: {
      red: { team_keys: s.redTeams.map((t) => `frc${t}`), score: -1 },
      blue: { team_keys: s.blueTeams.map((t) => `frc${t}`), score: -1 },
    },
    time: null,
    videos: [],
  }));

function TeamBrief({ c, color, ours, onOpen, summary }) {
  const p = c.profile;
  return (
    <div className={`brief ${color} ${ours ? 'is-ours' : ''}`}>
      <div className="brief-head">
        <div className="row" style={{ gap: 8 }}>
          <TeamChip team={c.team} color={color} mine={ours} scouted={summary} onOpen={onOpen} />
          <Badge tone={c.role === 'Unscouted' ? 'warn' : c.role === 'Primary scorer' ? 'accent' : c.role === 'Defender' ? 'danger' : 'neutral'}>{c.role}</Badge>
        </div>
        <span className="muted">{c.has ? `${p.matches} match${p.matches === 1 ? '' : 'es'} scouted` : 'no scouting'}</span>
      </div>
      {c.has ? (
        <>
          <div className="mini-stats">
            <div><span>Avg points</span><strong>{fmt(p.avg.total)}</strong></div>
            <div><span>Auto</span><strong>{fmt(p.avg.auto)}</strong></div>
            <div><span>Accuracy</span><strong>{pct(p.accuracy.overall)}</strong></div>
            <div><span>Climb rate</span><strong>{pct(p.climb.rate)}</strong></div>
            <div><span>Uptime</span><strong>{pct(p.reliability.uptime)}</strong></div>
            <div><span>Defense</span><strong>{fmt(p.defense.rating)}/5</strong></div>
          </div>
          {(c.notes.strengths[0] || c.notes.risks[0]) && (
            <ul className="brief-notes">
              {c.notes.strengths[0] && <li className="good"><Icon name="check" size={14} />{c.notes.strengths[0]}</li>}
              {c.notes.risks[0] && <li className="bad"><Icon name="alert" size={14} />{c.notes.risks[0]}</li>}
            </ul>
          )}
        </>
      ) : (
        <div className="mini-stats">
          <div><span>Model rating</span><strong>{fmt(c.rating)}</strong></div>
          <div><span>TBA rank</span><strong>{c.tba.rank ?? '–'}</strong></div>
          <div><span>Record</span><strong>{c.tba.record ?? '–'}</strong></div>
          <div><span>OPR</span><strong>{c.tba.opr !== null ? fmt(c.tba.opr) : '–'}</strong></div>
        </div>
      )}
    </div>
  );
}

export default function Strategy() {
  const comp = useCurrent();
  const { settings } = useApp();
  const summaries = getSummaries(comp);
  const eventKey = (comp.eventKey || '').trim();
  const [ours, setOurs] = useState((settings.myTeam || '').trim());
  const [draft, setDraft] = useState((settings.myTeam || '').trim());
  const [matchKey, setMatchKey] = useState('');
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mapView, setMapView] = useState('heat');
  const [now, setNow] = useState(Date.now());
  const alive = useRef(true);

  const canTba = Boolean(settings.tbaApiKey && eventKey);
  const refresh = async () => {
    if (!canTba) return;
    setLoading(true);
    try {
      const d = await loadEvent(eventKey);
      if (alive.current) { setEvent(d); setError(''); }
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setLoading(false);
    }
  };
  useEffect(() => { alive.current = true; refresh(); return () => { alive.current = false; }; }, [eventKey, settings.tbaApiKey]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);

  const matches = useMemo(() => sortMatches(event ? event.matches : fromSchedule(comp.schedule)), [event, comp.schedule]);
  const allTeams = useMemo(() => {
    const set = new Set(matches.flatMap((m) => [...m.alliances.red.team_keys, ...m.alliances.blue.team_keys].map(teamNum)));
    summaries.forEach((s) => set.add(s.teamNumber));
    return [...set].sort((a, b) => Number(a) - Number(b));
  }, [matches, summaries]);

  const mine = useMemo(() => matches.filter((m) => [...m.alliances.red.team_keys, ...m.alliances.blue.team_keys].some((k) => teamNum(k) === ours)), [matches, ours]);
  // Default to the team's next unplayed match whenever the team or schedule changes.
  useEffect(() => {
    if (!mine.length) { setMatchKey(''); return; }
    if (mine.some((m) => m.key === matchKey)) return;
    setMatchKey((mine.find((m) => !played(m)) || mine[mine.length - 1]).key);
  }, [mine]);
  const match = mine.find((m) => m.key === matchKey) || null;

  const field = useMemo(() => buildField(comp.matches, comp.paths, summaries), [comp.matches, comp.paths, summaries]);
  const fit = useMemo(() => fitModel(event ? event.matches : [], comp.matches, { tbaOprs: event?.oprs }), [event, comp.matches]);

  const plan = useMemo(() => {
    if (!match || !ours) return null;
    const red = match.alliances.red.team_keys.map(teamNum);
    const blue = match.alliances.blue.team_keys.map(teamNum);
    const pred = predictMatch(fit.model, red, blue);
    return { pred, red, blue, ...buildGamePlan({ ours, red, blue, pred, ctx: { field, model: fit.model, paths: comp.paths, rankings: event?.rankings, oprs: event?.oprs } }) };
  }, [match, ours, fit, field, comp.paths, event]);

  const grouped = useMemo(() => (plan ? PHASES.map((ph) => [ph, plan.recs.filter((r) => r.phase === ph)]).filter(([, l]) => l.length) : []), [plan]);
  const sc = (t) => summaries.find((x) => x.teamNumber === t) || null;
  const openTeam = (n) => { if (field.profiles.get(n)?.matches) { store.setSelectedTeam(n); store.go('teams'); } };
  const oppRuns = plan ? comp.paths.filter((p) => plan.opp.some((c) => c.team === p.teamNumber)) : [];
  const ourRuns = plan ? comp.paths.filter((p) => plan.mine.some((c) => c.team === p.teamNumber)) : [];
  const noteKey = match ? `${ours}:${match.key}` : '';

  // ---- empty states --------------------------------------------------------------
  if (!matches.length) {
    return (
      <div className="page"><div className="page-inner">
        <PageHeader title="Game Plan" subtitle="Strategy for your next match, built from scouting and TBA data" />
        <Card><Empty icon="crosshair" title="No match schedule yet" body="Game plans need to know who plays whom. Load the schedule from The Blue Alliance (Sync & Import) or set the event key." action={<div className="row"><Button variant="primary" onClick={() => store.go('sync')}>Go to Sync</Button>{loading && <Spinner />}</div>} /></Card>
      </div></div>
    );
  }

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          title="Game Plan"
          subtitle="Pick your team and match — get a plan from opponent and partner data"
          actions={canTba ? <Button icon="rotate" loading={loading} onClick={refresh}>Refresh TBA</Button> : <Badge tone="warn">Using saved schedule (no TBA)</Badge>}
        />
        {error && <div className="notice error" style={{ marginBottom: 14 }}>{error}</div>}

        <Card>
          <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
            <label className="field" style={{ width: 170 }}>
              <span className="field-label">Your team</span>
              <input className="input" list="strategy-teams" value={draft} placeholder="e.g. 1294" inputMode="numeric"
                onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setDraft(v); if (allTeams.includes(v)) { setOurs(v); if (v !== settings.myTeam) store.updateSettings({ myTeam: v }); } }} />
              <datalist id="strategy-teams">{allTeams.map((t) => <option key={t} value={t} />)}</datalist>
            </label>
            <label className="field grow" style={{ minWidth: 260 }}>
              <span className="field-label">Match</span>
              <select className="select" style={{ width: '100%' }} value={matchKey} onChange={(e) => setMatchKey(e.target.value)} disabled={!mine.length}>
                {!mine.length && <option value="">{ours ? `Team ${ours} has no matches in the schedule` : 'Enter a team number first'}</option>}
                {mine.map((m) => <option key={m.key} value={m.key}>{matchLabel(m, event?.info)} — {played(m) ? `played (${m.alliances.red.score}–${m.alliances.blue.score})` : `${clock(matchTime(m))} ${relTime(matchTime(m), now)}`}</option>)}
              </select>
            </label>
          </div>
        </Card>

        {!plan ? (
          <Card style={{ marginTop: 16 }}><Empty icon="crosshair" title={ours ? 'Pick a match' : 'Enter your team number'} body="Type the team you’re planning for (like 1294) and we’ll build a game plan for their next match." /></Card>
        ) : (
          <div key={match.key} className="stack tab-body" style={{ marginTop: 16, gap: 16 }}>
            <Card>
              <div className="plan-hero">
                <div>
                  <div className="plan-title">{matchLabel(match, event?.info)} <span className="muted">· {played(match) ? 'already played' : `${clock(matchTime(match))} · ${relTime(matchTime(match), now)}`}</span></div>
                  <p className="muted" style={{ marginTop: 4 }}>Planning for <strong style={{ color: 'var(--text)' }}>Team {ours}</strong> on the <strong style={{ color: plan.ourColor === 'red' ? 'var(--red-alliance)' : 'var(--blue-alliance)' }}>{plan.ourColor}</strong> alliance</p>
                  <div className="plan-sides">
                    <div className="alliance red"><b>Red</b>{plan.red.map((t) => <TeamChip key={t} team={t} color="red" mine={t === ours} scouted={sc(t)} onOpen={openTeam} />)}</div>
                    <div className="alliance blue"><b>Blue</b>{plan.blue.map((t) => <TeamChip key={t} team={t} color="blue" mine={t === ours} scouted={sc(t)} onOpen={openTeam} />)}</div>
                  </div>
                </div>
                <div className="plan-odds">
                  <div className="plan-odds-label">Our win chance</div>
                  <div className="plan-odds-value">{Math.round(plan.pOurs * 100)}%</div>
                  <WinBar pred={plan.pred} />
                </div>
              </div>
            </Card>

            <div className="grid-main" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)' }}>
              <div className="col">
                {grouped.map(([phase, list]) => (
                  <Card key={phase} title={<span className="row" style={{ gap: 8 }}><Icon name={PHASE_ICON[phase]} size={16} />{phase}</span>}>
                    <div className="stack" style={{ gap: 10 }}>
                      {list.map((r, i) => (
                        <div key={i} className={`rec ${r.priority}`}>
                          <div className="rec-top"><strong>{r.title}</strong><Badge tone={PRIORITY[r.priority].tone}>{PRIORITY[r.priority].label}</Badge></div>
                          <p>{r.detail}</p>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
                {grouped.length === 0 && <Card><Empty icon="chart" title="Not enough data to advise yet" body="Scout some of these teams or wait for TBA results to come in." /></Card>}
              </div>

              <div className="col">
                <Card title="Opponents" subtitle={`Expected ~${fmt(plan.oppExpected, 0)} pts`}>
                  <div className="stack" style={{ gap: 10 }}>
                    {[...plan.opp].sort((a, b) => b.threat - a.threat).map((c) => <TeamBrief key={c.team} c={c} summary={sc(c.team)} color={plan.ourColor === 'red' ? 'blue' : 'red'} onOpen={openTeam} />)}
                  </div>
                </Card>
                <Card title="Your alliance" subtitle={`Expected ~${fmt(plan.ourExpected, 0)} pts`}>
                  <div className="stack" style={{ gap: 10 }}>
                    {plan.mine.map((c) => <TeamBrief key={c.team} c={c} summary={sc(c.team)} color={plan.ourColor} ours={c.team === ours} onOpen={openTeam} />)}
                  </div>
                </Card>
              </div>
            </div>

            {(oppRuns.length > 0 || ourRuns.length > 0) && (
              <Card title="Where they play" subtitle="From AI-tracked robot paths" actions={<Segmented size="sm" value={mapView} onChange={setMapView} options={[{ value: 'heat', label: 'Heatmap' }, { value: 'paths', label: 'Paths' }]} />}>
                <div className="grid-2">
                  <div><h4 style={{ marginBottom: 8 }}>Opponents</h4>{oppRuns.length ? <FieldView runs={oppRuns} mode={mapView} /> : <p className="muted">No tracked paths for these opponents.</p>}</div>
                  <div><h4 style={{ marginBottom: 8 }}>Your alliance</h4>{ourRuns.length ? <FieldView runs={ourRuns} mode={mapView} /> : <p className="muted">No tracked paths for your alliance.</p>}</div>
                </div>
                <FieldLegend mode={mapView} />
              </Card>
            )}

            <Card title="Your match notes" subtitle="Saved with this competition">
              <textarea className="input" rows={4} placeholder="Drive-team notes, lane assignments, call-outs…" value={(comp.strategyNotes || {})[noteKey] || ''} onChange={(e) => store.setStrategyNote(noteKey, e.target.value)} />
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
