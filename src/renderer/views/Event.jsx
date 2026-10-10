import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { getSummaries, store, useApp, useCurrent } from '../store';
import { Badge, Button, Card, Empty, Icon, PageHeader, SearchInput, Segmented, Spinner, Stat, fmt } from '../components/ui';
import { BarList } from '../components/charts';
import { LEVEL_NAMES, clock, lastPlayed, loadEvent, matchLabel, matchTime, nextUp, played, relTime, sortMatches, tbaMatchUrl, tbaTeamUrl, teamNum, videoLinks } from '../lib/tbaLive';
import { naturalNumber } from '../../shared/models';

// Survives page switches so the view opens instantly with the last data.
let memo = { key: null, data: null };
const REFRESH_MS = 30000;

function TeamChip({ team, color, mine, scouted, onOpen }) {
  return (
    <button type="button" className={`tchip ${color} ${mine ? 'mine' : ''} ${scouted ? 'scouted' : ''}`} onClick={() => onOpen(team)} title={scouted ? `Scouted · pick score ${fmt(scouted.pickScore)} · rank ${scouted.rank}` : 'Open on The Blue Alliance'}>
      {team}
    </button>
  );
}

function MatchRow({ m, info, now, myTeam, scoutedBy, onTeam, onVideo, onTrace, downloading }) {
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
  const [data, setData] = useState(memo.key === eventKey ? memo.data : null);
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
    if (!eventKey) return;
    if (!silent) setLoading(true);
    try {
      const d = await loadEvent(eventKey);
      if (!alive.current) return;
      memo = { key: eventKey, data: d };
      setData(d);
      setError('');
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [eventKey]);

  useEffect(() => {
    alive.current = true;
    refresh(Boolean(data));
    return () => { alive.current = false; };
  }, [refresh]);

  useEffect(() => {
    if (!auto || !eventKey) return undefined;
    const id = setInterval(() => refresh(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [auto, eventKey, refresh]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(id);
  }, []);

  const scoutedBy = useMemo(() => Object.fromEntries(summaries.map((s) => [s.teamNumber, s])), [summaries]);
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
  if (!settings.tbaApiKey || !eventKey) {
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
              <label className="check muted"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-refresh</label>
              {data && <span className="muted" style={{ fontSize: 12 }}>Updated {new Date(data.fetchedAt).toLocaleTimeString()}</span>}
              <Button icon="rotate" loading={loading} onClick={() => refresh(false)}>Refresh</Button>
              {info?.webcasts?.length > 0 && <Button icon="play" onClick={() => api.shell.openExternal(`https://www.youtube.com/watch?v=${info.webcasts[0].channel}`)}>Webcast</Button>}
              <Button variant="ghost" icon="external" onClick={() => api.shell.openExternal(`https://www.thebluealliance.com/event/${eventKey}`)}>TBA</Button>
            </>
          }
        />

        {error && <div className="notice error" style={{ marginBottom: 14 }}>{error}{data ? ' — showing the last data we have.' : ''}</div>}
        {!data && loading && <div className="event-empty"><Spinner /> Loading event…</div>}

        {data && (
          <>
            <div className="stat-grid four">
              <Stat label="Qualification progress" value={`${qualsDone}/${quals.length}`} hint={quals.length ? `${Math.round((qualsDone / quals.length) * 100)}% played` : 'no schedule posted'} tone="accent" />
              <div className="stat tone-teal">
                <div className="stat-label">Next up</div>
                <div className="stat-value" style={{ fontSize: 20 }}>{up ? matchLabel(up, info) : '—'}</div>
                <div className="stat-hint">{up ? `${clock(matchTime(up))} · ${relTime(matchTime(up), now)}` : 'nothing scheduled'}</div>
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
              <Segmented value={tab} onChange={setTab} options={[{ value: 'matches', label: 'Matches' }, { value: 'rankings', label: 'Rankings' }, { value: 'opr', label: 'OPR' }, { value: 'playoffs', label: 'Alliances' }, { value: 'awards', label: 'Awards' }]} />
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
                    {ordered.map((m) => <MatchRow key={m.key} m={m} info={info} now={now} myTeam={myTeam} scoutedBy={scoutedBy} onTeam={openTeam} onVideo={onVideo} onTrace={onTrace} downloading={dl} />)}
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
                    {matches.filter((m) => m.comp_level !== 'qm').map((m) => <MatchRow key={m.key} m={m} info={info} now={now} myTeam={myTeam} scoutedBy={scoutedBy} onTeam={openTeam} onVideo={onVideo} onTrace={onTrace} downloading={dl} />)}
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
