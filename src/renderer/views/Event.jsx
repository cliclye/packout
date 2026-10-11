import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { getSummaries, store, useApp, useCurrent } from '../store';
import { AnimatedValue, Badge, Button, Card, Empty, Icon, PageHeader, SearchInput, Segmented, Spinner, Stat, fmt } from '../components/ui';
import { BarList } from '../components/charts';
import { LEVEL_NAMES, eventMemo, clock, lastPlayed, loadEvent, matchLabel, matchTime, nextUp, played, relTime, sortMatches, tbaMatchUrl, tbaTeamUrl, teamNum, videoLinks } from '../lib/tbaLive';
import { naturalNumber } from '../../shared/models';
import { fitModel, predictMatch, simulateQuals } from '../../shared/predict';

// Survives page switches so the view opens instantly with the last data.
const REFRESH_MS = 30000;

const pc = (p) => `${Math.round(p * 100)}%`;

/** Statbotics-style split bar: red win % vs blue win %, with projected scores. */
export function WinBar({ pred, big = false }) {
  const r = Math.round(pred.pRed * 100);
  return (
    <div className={`winbar ${big ? 'big' : ''}`} title={`Projected score ${Math.round(pred.muR)} – ${Math.round(pred.muB)}`}>
      <div className="winbar-track">
        <span className="wb-red" style={{ width: `${Math.max(8, Math.min(92, pred.pRed * 100))}%` }}>{r}%</span>
        <span className="wb-blue">{100 - r}%</span>
      </div>
      <div className="winbar-sub"><span>Red {Math.round(pred.muR)}</span><span>Blue {Math.round(pred.muB)}</span></div>
    </div>
  );
}

export function TeamChip({ team, color, mine, scouted, onOpen }) {
  return (
    <button type="button" className={`tchip ${color} ${mine ? 'mine' : ''} ${scouted ? 'scouted' : ''}`} onClick={() => onOpen(team)} title={scouted ? `Scouted · pick score ${fmt(scouted.pickScore)} · rank ${scouted.rank}` : 'Open on The Blue Alliance'}>
      {team}
    </button>
  );
}

/** Always-visible scoreboard for the prediction model: how often it called the winner. */
function AccuracyBanner({ fit, matches, info, onOpen }) {
  const bt = fit.backtest;
  const dots = useMemo(
    () => sortMatches(matches).filter(played).sort((a, b) => matchTime(a) - matchTime(b)).map((m) => ({ m, h: bt.hits.get(m.key) })).filter((d) => d.h && d.h.actual !== 'tie').slice(-30),
    [matches, bt]
  );
  const pctTxt = bt.accuracy === null ? '–' : `${Math.round(bt.accuracy * 100)}%`;
  const small = bt.n < 20;
  return (
    <button type="button" className="acc-banner" onClick={onOpen} title="Open predictions">
      <div className="acc-main">
        <span className="acc-label"><Icon name="sparkles" size={15} /> Prediction model</span>
        <span className="acc-value"><AnimatedValue value={pctTxt} /></span>
        <span className="acc-sub">{bt.n ? `${bt.correct} of ${bt.n} matches called correctly` : 'Needs 6+ played matches to score itself'}</span>
      </div>
      <div className="acc-dots" aria-label="Recent predictions">
        {dots.length === 0 && <span className="muted">No results to grade yet</span>}
        {dots.map(({ m, h }) => (
          <i key={m.key} className={h.ok ? 'hit' : 'miss'} title={`${matchLabel(m, info)}: model said ${h.pRed >= 0.5 ? 'Red' : 'Blue'} ${Math.round(Math.max(h.pRed, h.pBlue) * 100)}% — ${h.ok ? 'correct' : 'upset'}`} />
        ))}
      </div>
      <div className="acc-meta">
        <span>{small && bt.n ? 'Small sample — still learning' : 'Graded blind on matches it hadn’t seen'}</span>
        {bt.brier !== null && <span>Brier {bt.brier.toFixed(3)}</span>}
      </div>
    </button>
  );
}

function MatchRow({ m, info, now, myTeam, scoutedBy, onTeam, onVideo, onTrace, downloading, pred, hit }) {
  const red = m.alliances.red;
  const blue = m.alliances.blue;
  const done = played(m);
  const winner = done ? m.winning_alliance : '';
  const t = matchTime(m);
  const mine = (list) => list.some((k) => teamNum(k) === myTeam);
  const videos = videoLinks(m);
  const yt = (m.videos || []).find((v) => v.type === 'youtube');
  return (
    <div className={`mrow ${done ? 'done' : 'pending'} ${myTeam && (mine(red.team_keys) || mine(blue.team_keys)) ? 'is-mine' : ''}`}>
      <div className="mrow-meta">
        <strong>{matchLabel(m, info)}</strong>
        <small>{done ? `${clock(t)}` : `${clock(t)} · ${relTime(t, now)}`}</small>
        {done && <Badge tone={winner === 'red' ? 'danger' : winner === 'blue' ? 'accent' : 'neutral'}>{winner === 'red' ? 'Red won' : winner === 'blue' ? 'Blue won' : 'Tie'}</Badge>}
      </div>
      {[['red', red], ['blue', blue]].map(([color, al]) => (
        <div key={color} className={`mside ${color} ${winner === color ? 'win' : ''}`}>
          <div className="mteams">
            {al.team_keys.map((k) => {
              const n = teamNum(k);
              return <TeamChip key={k} team={n} color={color} mine={n === myTeam} scouted={scoutedBy[n]} onOpen={onTeam} />;
            })}
          </div>
          <span className="mscore">{done ? al.score : '–'}{winner === color && <Icon name="check" size={14} />}</span>
        </div>
      ))}
      {(pred || hit) && (
        <div className="mpred">
          {pred && <WinBar pred={pred} />}
          {hit && (
            <div className={`pre-call ${hit.ok ? 'ok' : 'miss'}`}>
              <Icon name={hit.ok ? 'check' : 'x'} size={13} />
              <span>Model had {hit.pRed >= 0.5 ? 'Red' : 'Blue'} at {pc(Math.max(hit.pRed, hit.pBlue))}{hit.ok ? '' : ' — upset'}</span>
            </div>
          )}
        </div>
      )}
      <div className="mrow-actions">
        {videos.map((v, i) => <Button key={i} size="sm" icon="play" onClick={() => api.shell.openExternal(v.url)}>{v.type === 'YouTube' ? 'Watch' : 'TBA video'}</Button>)}
        {yt && m.comp_level === 'qm' && <Button size="sm" variant="ghost" icon={downloading === m.key ? undefined : 'film'} loading={downloading === m.key} onClick={() => onVideo(m, yt)} title="Download into Film Review for this match">Film Review</Button>}
        {yt && <Button size="sm" variant="ghost" icon="route" onClick={() => onTrace(m, yt)} title="Start an AI trace from this video">Trace</Button>}
        <Button size="sm" variant="ghost" icon="external" onClick={() => api.shell.openExternal(tbaMatchUrl(m))} aria-label="Open on TBA" />
      </div>
    </div>
  );
}

export default function Event() {
  const comp = useCurrent();
  const { settings } = useApp();
  const summaries = getSummaries(comp);
  const eventKey = (comp.eventKey || '').trim();
  const snap = comp.tbaSnapshot && comp.tbaSnapshot.info?.key === eventKey ? comp.tbaSnapshot : null;
  const canLive = Boolean(settings.tbaApiKey && eventKey);
  const [data, setData] = useState(eventMemo.key === eventKey && eventMemo.data ? eventMemo.data : snap);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [auto, setAuto] = useState(true);
  const [tab, setTab] = useState('matches');
  const [filter, setFilter] = useState('all');
  const [level, setLevel] = useState('all');
  const [search, setSearch] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [keyDraft, setKeyDraft] = useState(eventKey);
  const [dl, setDl] = useState('');
  const myTeam = (settings.myTeam || '').trim();
  const alive = useRef(true);
  const defaulted = useRef(false);

  const refresh = useCallback(async (silent = false) => {
    if (!eventKey || !canLive) return;
    if (!silent) setLoading(true);
    try {
      const d = await loadEvent(eventKey);
      if (!alive.current) return;
      eventMemo.key = eventKey;
      eventMemo.data = d;
      setData(d);
      setError('');
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [eventKey, canLive]);

  useEffect(() => {
    alive.current = true;
    refresh(Boolean(data));
    return () => { alive.current = false; };
  }, [refresh]);

  useEffect(() => {
    if (!auto || !canLive) return undefined;
    const id = setInterval(() => refresh(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [auto, eventKey, refresh]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(id);
  }, []);

  const scoutedBy = useMemo(() => Object.fromEntries(summaries.map((s) => [s.teamNumber, s])), [summaries]);
  // Rating model: TBA results + our scouting (leave-one-out σ, so confidence is honest).
  const fit = useMemo(() => (data ? fitModel(data.matches, comp.matches, { tbaOprs: data.oprs }) : null), [data, comp.matches]);
  const predFor = useCallback((m) => (fit ? predictMatch(fit.model, m.alliances.red.team_keys, m.alliances.blue.team_keys) : null), [fit]);
  const openTeam = (n) => {
    if (scoutedBy[n]) { store.setSelectedTeam(n); store.go('teams'); } else api.shell.openExternal(tbaTeamUrl(n, data?.info?.year || new Date().getFullYear()));
  };

  const onVideo = async (m, yt) => {
    setDl(m.key);
    try {
      const file = await api.video.download({ url: `https://www.youtube.com/watch?v=${yt.key}`, matchNumber: String(m.match_number), jobId: m.key });
      store.setMatchVideo(String(m.match_number), file);
      store.toast(`Video for ${matchLabel(m, data.info)} added to Film Review`, 'success');
    } catch (e) {
      store.toast(e.message.split('\n')[0], 'error');
    } finally {
      setDl('');
    }
  };
  const onTrace = (m, yt) => {
    store.setTraceSeed({ url: `https://www.youtube.com/watch?v=${yt.key}`, matchNumber: m.comp_level === 'qm' ? String(m.match_number) : '', red: m.alliances.red.team_keys.map(teamNum), blue: m.alliances.blue.team_keys.map(teamNum) });
    store.go('trace');
  };

  const matches = useMemo(() => (data ? sortMatches(data.matches) : []), [data]);
  const quals = matches.filter((m) => m.comp_level === 'qm');
  const qualsDone = quals.filter(played).length;
  const up = data ? nextUp(quals.length && quals.some((m) => !played(m)) ? quals : matches) : null;
  const last = data ? lastPlayed(matches) : null;
  const myRank = data?.rankings?.rankings.find((r) => teamNum(r.team_key) === myTeam);
  const myNext = myTeam ? matches.filter((m) => !played(m)).find((m) => [...m.alliances.red.team_keys, ...m.alliances.blue.team_keys].some((k) => teamNum(k) === myTeam)) : null;

  const shown = useMemo(() => {
    const q = search.trim();
    return matches.filter((m) => {
      if (filter === 'upcoming' && played(m)) return false;
      if (filter === 'played' && !played(m)) return false;
      if (level !== 'all' && m.comp_level !== level) return false;
      const teams = [...m.alliances.red.team_keys, ...m.alliances.blue.team_keys].map(teamNum);
      if (onlyMine && !teams.includes(myTeam)) return false;
      if (q && !teams.some((t) => t.includes(q))) return false;
      return true;
    });
  }, [matches, filter, level, search, onlyMine, myTeam]);
  // First time data shows up mid-event, open on what's coming next.
  useEffect(() => {
    if (!data || defaulted.current) return;
    defaulted.current = true;
    const some = data.matches.some(played);
    if (some && data.matches.some((m) => !played(m))) setFilter('upcoming');
  }, [data]);
  const ordered = filter === 'played' ? [...shown].reverse() : shown;
  const levelsPresent = [...new Set(matches.map((m) => m.comp_level))];

  // ---- empty states -------------------------------------------------------
  if (!data && (!settings.tbaApiKey || !eventKey)) {
    return (
      <div className="page"><div className="page-inner">
        <PageHeader title="Event Live" subtitle="Scores, schedule, rankings and videos from The Blue Alliance" />
        <Card>
          <div className="stack" style={{ maxWidth: 520, margin: '0 auto', padding: '8px 0' }}>
            <Empty icon="trophy" title={!settings.tbaApiKey ? 'Add your Blue Alliance key' : 'Set this competition’s event key'} body="Live results come straight from The Blue Alliance API for the event key tied to this competition." />
            {!settings.tbaApiKey && <Button variant="primary" onClick={() => store.go('settings')}>Open Settings</Button>}
            <div className="row">
              <input className="input grow" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="Event key, e.g. 2026pncmp" spellCheck={false} />
              <Button variant="primary" disabled={!keyDraft.trim()} onClick={() => store.updateCompetition({ eventKey: keyDraft.trim() })}>Save key</Button>
            </div>
          </div>
        </Card>
      </div></div>
    );
  }

  const info = data?.info;
  const rankCols = data?.rankings?.sort_order_info || [];

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          title={info?.name || 'Event Live'}
          subtitle={info ? `${[info.city, info.state_prov].filter(Boolean).join(', ')} · ${info.start_date} → ${info.end_date} · ${eventKey}` : eventKey}
          actions={
            <>
              {!canLive && <Badge tone="warn">Snapshot · {new Date(data.fetchedAt).toLocaleString()}</Badge>}
              {canLive && <label className="check muted"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-refresh</label>}
              {data && <span className="muted" style={{ fontSize: 12 }}>Updated {new Date(data.fetchedAt).toLocaleTimeString()}</span>}
              {canLive && <Button icon="rotate" loading={loading} onClick={() => refresh(false)}>Refresh</Button>}
              {info?.webcasts?.length > 0 && <Button icon="play" onClick={() => api.shell.openExternal(`https://www.youtube.com/watch?v=${info.webcasts[0].channel}`)}>Webcast</Button>}
              <Button variant="ghost" icon="external" onClick={() => api.shell.openExternal(`https://www.thebluealliance.com/event/${eventKey}`)}>TBA</Button>
            </>
          }
        />

        {error && <div className="notice error" style={{ marginBottom: 14 }}>{error}{data ? ' — showing the last data we have.' : ''}</div>}
        {!data && loading && <div className="event-empty"><Spinner /> Loading event…</div>}

        {data && (
          <>
            {fit && <AccuracyBanner fit={fit} matches={data.matches} info={info} onOpen={() => setTab('predict')} />}
            <div className="stat-grid four">
              <Stat label="Qualification progress" value={`${qualsDone}/${quals.length}`} hint={quals.length ? `${Math.round((qualsDone / quals.length) * 100)}% played` : 'no schedule posted'} tone="accent" />
              <div className="stat tone-teal">
                <div className="stat-label">Next up</div>
                <div className="stat-value" style={{ fontSize: 20 }}>{up ? matchLabel(up, info) : '—'}</div>
                <div className="stat-hint">{up ? `${clock(matchTime(up))} · ${relTime(matchTime(up), now)}` : 'nothing scheduled'}</div>
                {up && fit && <div style={{ marginTop: 8 }}><WinBar pred={predFor(up)} /></div>}
              </div>
              <div className="stat tone-ok">
                <div className="stat-label">Latest result</div>
                <div className="stat-value" style={{ fontSize: 20 }}>{last ? `${last.alliances.red.score} – ${last.alliances.blue.score}` : '—'}</div>
                <div className="stat-hint">{last ? `${matchLabel(last, info)} · ${last.winning_alliance ? last.winning_alliance + ' won' : 'tie'}` : 'no matches played'}</div>
              </div>
              <div className="stat tone-pink">
                <div className="stat-label">{myTeam ? `Team ${myTeam}` : 'Your team'}</div>
                {myTeam ? (
                  <>
                    <div className="stat-value" style={{ fontSize: 20 }}>{myRank ? `Rank ${myRank.rank} · ${myRank.record.wins}-${myRank.record.losses}-${myRank.record.ties}` : 'Not ranked yet'}</div>
                    <div className="stat-hint">{myNext ? `Next: ${matchLabel(myNext, info)} ${relTime(matchTime(myNext), now)}` : 'no upcoming matches'}</div>
                  </>
                ) : (
                  <input className="input" style={{ marginTop: 6 }} placeholder="Enter team #" onKeyDown={(e) => e.key === 'Enter' && store.updateSettings({ myTeam: e.currentTarget.value.replace(/\D/g, '') })} onBlur={(e) => e.target.value && store.updateSettings({ myTeam: e.target.value.replace(/\D/g, '') })} />
                )}
              </div>
            </div>

            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <Segmented value={tab} onChange={setTab} options={[{ value: 'matches', label: 'Matches' }, { value: 'rankings', label: 'Rankings' }, { value: 'predict', label: 'Predictions' }, { value: 'opr', label: 'OPR' }, { value: 'playoffs', label: 'Alliances' }, { value: 'awards', label: 'Awards' }]} />
              {myTeam && <button type="button" className="link-btn" onClick={() => store.updateSettings({ myTeam: '' })}>Change team ({myTeam})</button>}
            </div>

            <div key={tab} className="tab-body">
              {tab === 'matches' && (
                <>
                  <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
                    <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: 'all', label: `All (${matches.length})` }, { value: 'upcoming', label: 'Upcoming' }, { value: 'played', label: 'Results' }]} />
                    {levelsPresent.length > 1 && (
                      <select className="select" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Round">
                        <option value="all">All rounds</option>
                        {levelsPresent.map((l) => <option key={l} value={l}>{LEVEL_NAMES[l]}</option>)}
                      </select>
                    )}
                    <SearchInput className="grow" value={search} onChange={setSearch} placeholder="Filter by team number…" />
                    {myTeam && <label className="check"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Only {myTeam}</label>}
                  </div>
                  <div className="list match-list">
                    {ordered.map((m) => <MatchRow key={m.key} m={m} info={info} now={now} myTeam={myTeam} scoutedBy={scoutedBy} onTeam={openTeam} onVideo={onVideo} onTrace={onTrace} downloading={dl} pred={played(m) ? null : predFor(m)} hit={fit?.backtest.hits.get(m.key)} />)}
                    {ordered.length === 0 && <Card><Empty icon="flag" title="No matches" body={matches.length ? 'Nothing matches those filters.' : 'The schedule has not been posted on The Blue Alliance yet.'} /></Card>}
                  </div>
                </>
              )}

              {tab === 'rankings' && (
                <Card flush title={data.rankings ? `${data.rankings.rankings.length} teams` : undefined}>
                  {!data.rankings ? <Empty icon="chart" title="No rankings yet" body="Rankings appear after the first qualification matches are scored." /> : (
                    <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
                      <table className="table">
                        <thead>
                          <tr><th>#</th><th>Team</th><th>Record</th><th>Played</th>{rankCols.map((c) => <th key={c.name} className="num">{c.name}</th>)}<th className="num" title="Your scouting pick score">Scouted</th></tr>
                        </thead>
                        <tbody>
                          {data.rankings.rankings.map((r) => {
                            const n = teamNum(r.team_key);
                            const s = scoutedBy[n];
                            return (
                              <tr key={r.team_key} className={`clickable ${n === myTeam ? 'selected' : ''}`} onClick={() => openTeam(n)}>
                                <td><strong>{r.rank}</strong></td>
                                <td><strong>{n}</strong>{r.dq ? <Badge tone="danger"> DQ</Badge> : null}</td>
                                <td>{r.record.wins}-{r.record.losses}-{r.record.ties}</td>
                                <td>{r.matches_played}</td>
                                {rankCols.map((c, i) => <td key={c.name} className="num">{fmt(r.sort_orders[i], c.precision ?? 0)}</td>)}
                                <td className="num">{s ? <Badge tone="accent">{fmt(s.pickScore)} · #{s.rank}</Badge> : <span className="muted">–</span>}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              )}

              {tab === 'predict' && <PredictTab data={data} fit={fit} comp={comp} scoutedBy={scoutedBy} myTeam={myTeam} info={info} now={now} onTeam={openTeam} predFor={predFor} />}

              {tab === 'opr' && <OprTab data={data} scoutedBy={scoutedBy} myTeam={myTeam} onTeam={openTeam} />}

              {tab === 'playoffs' && (
                <div className="stack" style={{ gap: 16 }}>
                  {data.alliances.length === 0 ? (
                    <Card><Empty icon="users" title="Alliance selection hasn’t happened yet" body="Alliances and the playoff bracket show up here once they’re set." /></Card>
                  ) : (
                    <div className="grid-2">
                      {data.alliances.map((a, i) => (
                        <Card key={i} title={a.name || `Alliance ${i + 1}`} actions={a.status && <Badge tone={a.status.status === 'won' ? 'ok' : a.status.status === 'eliminated' ? 'danger' : 'accent'}>{a.status.status === 'won' ? 'Champions' : a.status.status === 'eliminated' ? 'Eliminated' : a.status.level ? LEVEL_NAMES[a.status.level] || a.status.level : 'Playing'}</Badge>}>
                          <div className="pill-row">{a.picks.map((k) => <TeamChip key={k} team={teamNum(k)} color="blue" mine={teamNum(k) === myTeam} scouted={scoutedBy[teamNum(k)]} onOpen={openTeam} />)}</div>
                          {a.status?.record && <p className="muted" style={{ marginTop: 8 }}>Playoff record {a.status.record.wins}-{a.status.record.losses}-{a.status.record.ties}</p>}
                        </Card>
                      ))}
                    </div>
                  )}
                  <div className="list match-list">
                    {matches.filter((m) => m.comp_level !== 'qm').map((m) => <MatchRow key={m.key} m={m} info={info} now={now} myTeam={myTeam} scoutedBy={scoutedBy} onTeam={openTeam} onVideo={onVideo} onTrace={onTrace} downloading={dl} pred={played(m) ? null : predFor(m)} hit={fit?.backtest.hits.get(m.key)} />)}
                  </div>
                </div>
              )}

              {tab === 'awards' && (
                data.awards.length === 0 ? <Card><Empty icon="trophy" title="No awards yet" body="Awards are posted at the end of the event." /></Card> : (
                  <div className="grid-2">
                    {data.awards.map((a, i) => (
                      <Card key={i} title={a.name}>
                        <div className="stack" style={{ gap: 8 }}>
                          {a.recipient_list.map((r, j) => (
                            <div key={j} className="row" style={{ justifyContent: 'space-between' }}>
                              <span>{r.awardee || 'Team'}</span>
                              {r.team_key && <TeamChip team={teamNum(r.team_key)} color="blue" mine={teamNum(r.team_key) === myTeam} scouted={scoutedBy[teamNum(r.team_key)]} onOpen={openTeam} />}
                            </div>
                          ))}
                        </div>
                      </Card>
                    ))}
                  </div>
                )
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OprTab({ data, scoutedBy, myTeam, onTeam }) {
  const [sort, setSort] = useState('opr');
  const rows = useMemo(() => {
    if (!data.oprs) return [];
    const rank = Object.fromEntries((data.rankings?.rankings || []).map((r) => [teamNum(r.team_key), r.rank]));
    return Object.keys(data.oprs.oprs).map((k) => {
      const n = teamNum(k);
      return { n, opr: data.oprs.oprs[k], dpr: data.oprs.dprs?.[k] ?? 0, ccwm: data.oprs.ccwms?.[k] ?? 0, rank: rank[n] };
    }).sort((a, b) => b[sort] - a[sort]);
  }, [data, sort]);
  if (!data.oprs) return <Card><Empty icon="chart" title="OPR not available yet" body="OPR is computed by TBA once enough qualification matches have been played." /></Card>;
  return (
    <div className="grid-main" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.3fr)' }}>
      <Card title="Top OPR" subtitle="Offensive power rating — estimated points each team adds">
        <BarList items={rows.slice(0, 15).map((r) => ({ key: r.n, label: r.n, value: r.opr }))} onSelect={onTeam} format={(v) => fmt(v)} selected={myTeam} />
      </Card>
      <Card title="All teams" flush actions={<Segmented size="sm" value={sort} onChange={setSort} options={[{ value: 'opr', label: 'OPR' }, { value: 'ccwm', label: 'CCWM' }, { value: 'dpr', label: 'DPR' }]} />}>
        <div style={{ overflow: 'auto', maxHeight: '65vh' }}>
          <table className="table">
            <thead><tr><th>Team</th><th>Rank</th><th className="num">OPR</th><th className="num">DPR</th><th className="num">CCWM</th><th className="num">Scouted avg</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const s = scoutedBy[r.n];
                return (
                  <tr key={r.n} className={`clickable ${r.n === myTeam ? 'selected' : ''}`} onClick={() => onTeam(r.n)}>
                    <td><strong>{r.n}</strong></td><td>{r.rank ?? '–'}</td>
                    <td className="num">{fmt(r.opr)}</td><td className="num">{fmt(r.dpr)}</td><td className="num">{fmt(r.ccwm)}</td>
                    <td className="num">{s ? fmt(s.averageScore) : <span className="muted">–</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function PredictTab({ data, fit, comp, scoutedBy, myTeam, info, now, onTeam, predFor }) {
  const { model, backtest } = fit;
  const rated = useMemo(() => [...model.rating.entries()].map(([team, r]) => ({ team, ...r })).sort((a, b) => b.value - a.value), [model]);
  const upcoming = useMemo(() => sortMatches(data.matches).filter((m) => !played(m)), [data]);
  const sim = useMemo(() => simulateQuals(model, data.matches), [model, data]);
  const [view, setView] = useState('standings');
  const [red, setRed] = useState(['', '', '']);
  const [blue, setBlue] = useState(['', '', '']);
  const teamOptions = rated.map((r) => r.team);
  const custom = red.every(Boolean) && blue.every(Boolean) ? predictMatch(model, red, blue) : null;
  const hasSignal = rated.some((r) => r.source !== 'prior');
  const scoutedTeams = rated.filter((r) => r.scoutMatches > 0).length;
  const sourceTone = { blend: 'accent', tba: 'neutral', scouting: 'ok', prior: 'neutral' };
  const sourceLabel = { blend: 'Scouting + TBA', tba: 'TBA results', scouting: 'Scouting only', prior: 'No data' };
  const topN = Math.min(8, Math.max(1, Math.floor(sim.length / 4)));

  if (!hasSignal) return <Card><Empty icon="chart" title="Not enough data to predict yet" body="Predictions start once a few matches have been played on TBA or you've scouted some teams." /></Card>;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="stat-grid four" style={{ marginBottom: 0 }}>
        <Stat label="Model accuracy" value={backtest.accuracy === null ? '–' : `${Math.round(backtest.accuracy * 100)}%`} hint={backtest.n ? `${backtest.correct}/${backtest.n} played matches called right (blind)` : 'needs 6+ played matches'} tone="ok" />
        <Stat label="Typical score error" value={backtest.sigma ? `±${Math.round(backtest.sigma)}` : '–'} hint="per alliance, points" tone="accent" />
        <Stat label="Teams rated" value={rated.length} hint={`${scoutedTeams} with your scouting`} tone="teal" />
        <Stat label="Matches left" value={upcoming.length} hint={`${Math.round(model.trainedOn)} played used for ratings`} tone="pink" />
      </div>

      <div className="grid-main" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)' }}>
        <div className="col">
          <Card title="Coming up" subtitle="Win probability for the next matches">
            {upcoming.length === 0 ? <p className="muted">No unplayed matches left.</p> : (
              <div className="stack" style={{ gap: 14 }}>
                {upcoming.slice(0, 8).map((m) => {
                  const p = predFor(m);
                  const mine = [...m.alliances.red.team_keys, ...m.alliances.blue.team_keys].some((k) => teamNum(k) === myTeam);
                  return (
                    <div key={m.key} className={`pred-row ${mine ? 'is-mine' : ''}`}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <strong>{matchLabel(m, info)}</strong>
                        <span className="muted">{clock(matchTime(m))} · {relTime(matchTime(m), now)}</span>
                      </div>
                      <WinBar pred={p} big />
                      <div className="row pred-teams">
                        <div className="mteams">{m.alliances.red.team_keys.map((k) => <TeamChip key={k} team={teamNum(k)} color="red" mine={teamNum(k) === myTeam} scouted={scoutedBy[teamNum(k)]} onOpen={onTeam} />)}</div>
                        <div className="mteams">{m.alliances.blue.team_keys.map((k) => <TeamChip key={k} team={teamNum(k)} color="blue" mine={teamNum(k) === myTeam} scouted={scoutedBy[teamNum(k)]} onOpen={onTeam} />)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="Matchup simulator" subtitle="Pick any six teams to see who would win">
            <div className="grid-2" style={{ gap: 12 }}>
              {[['Red alliance', red, setRed, 'red'], ['Blue alliance', blue, setBlue, 'blue']].map(([label, val, set, color]) => (
                <div key={label} className={`alliance-box ${color}`}>
                  <h4>{label}</h4>
                  <div className="stack" style={{ gap: 6 }}>
                    {val.map((v, i) => (
                      <select key={i} className="select" style={{ width: '100%' }} value={v} onChange={(e) => set(val.map((x, j) => (j === i ? e.target.value : x)))}>
                        <option value="">Team {i + 1}…</option>
                        {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14 }}>{custom ? <WinBar pred={custom} big /> : <p className="muted">Choose three teams per side.</p>}</div>
          </Card>
        </div>

        <div className="col">
          <Card title="Model accuracy" subtitle="How the model did on matches it hadn’t seen">
            <p className="muted" style={{ lineHeight: 1.5 }}>
              Every played match is predicted by a model trained on all <em>other</em> matches (and without that match’s scouting rows), so these numbers aren’t flattered.
              {backtest.brier !== null && <> Brier score <strong>{backtest.brier.toFixed(3)}</strong> (0.25 = coin flip, lower is better).</>}
            </p>
            <div className="metric-rows" style={{ marginTop: 12 }}>
              <div className="metric-row">
                <div className="metric-row-top"><span>Called correctly</span><strong>{backtest.accuracy === null ? '–' : pc(backtest.accuracy)}</strong></div>
                <div className="pct-track"><span className="pct-fill good" style={{ width: `${(backtest.accuracy || 0) * 100}%` }} /></div>
              </div>
              <div className="metric-row">
                <div className="metric-row-top"><span>Scouting coverage</span><strong>{rated.length ? pc(scoutedTeams / rated.length) : '–'}</strong></div>
                <div className="pct-track"><span className="pct-fill mid" style={{ width: `${rated.length ? (scoutedTeams / rated.length) * 100 : 0}%` }} /></div>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 12, fontSize: 12.5 }}>
              Ratings blend {model.scale ? 'your scouted average points (mapped onto the match-score scale)' : 'scouting'} with a regularised OPR fitted to TBA scores. Early in an event scouting carries more weight; as results accumulate, TBA takes over.
            </p>
          </Card>

          <Card title="Qualification outlook" subtitle="2,000 simulated finishes of the remaining quals — ranked by win count" flush
            actions={<Segmented size="sm" value={view} onChange={setView} options={[{ value: 'standings', label: 'Projected' }, { value: 'ratings', label: 'Ratings' }]} />}>
            <div style={{ overflow: 'auto', maxHeight: '60vh' }}>
              {view === 'standings' ? (
                <table className="table">
                  <thead><tr><th>Team</th><th className="num">Wins</th><th className="num">Proj.</th><th className="num">Top {topN}</th><th className="num">Avg rank</th></tr></thead>
                  <tbody>
                    {sim.map((r) => (
                      <tr key={r.team} className={`clickable ${r.team === myTeam ? 'selected' : ''}`} onClick={() => onTeam(r.team)}>
                        <td><strong>{r.team}</strong></td>
                        <td className="num">{r.wins}</td>
                        <td className="num">{r.expectedWins.toFixed(1)}</td>
                        <td className="num">{pc(r.topN)}</td>
                        <td className="num">{r.avgRank.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="table">
                  <thead><tr><th>Team</th><th className="num">Rating</th><th>Source</th></tr></thead>
                  <tbody>
                    {rated.map((r) => (
                      <tr key={r.team} className={`clickable ${r.team === myTeam ? 'selected' : ''}`} onClick={() => onTeam(r.team)}>
                        <td><strong>{r.team}</strong></td>
                        <td className="num">{fmt(r.value)}</td>
                        <td><Badge tone={sourceTone[r.source]}>{sourceLabel[r.source]}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
