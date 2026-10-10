import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, mediaUrl } from '../api';
import { store, useCurrent } from '../store';
import { Badge, Button, Card, Empty, Icon, PageHeader, Progress, Segmented, fmt, pct } from '../components/ui';
import FieldView, { FieldLegend } from '../components/FieldView';
import { byNatural, climbLabel, estimatedScore, naturalNumber, shootingEfficiency } from '../../shared/models';

const RED_SHADES = ['#ff5a5f', '#ff8a5f', '#ffb05f'];
const BLUE_SHADES = ['#4d8dff', '#4dc9ff', '#8d7dff'];
const CHECKPOINTS = [['Auto', 0], ['Teleop', 15], ['Endgame', 105]];

export default function Film() {
  const comp = useCurrent();
  const videoRef = useRef(null);
  const [match, setMatch] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [videoError, setVideoError] = useState('');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sync, setSync] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hidden, setHidden] = useState(() => new Set());
  const jobId = useRef('');

  const matchNumbers = useMemo(() => {
    const set = new Set([...comp.matches.map((m) => m.matchNumber), ...comp.schedule.map((s) => String(s.matchNumber))]);
    comp.videos.forEach((v) => v.inferredMatchNumber && set.add(v.inferredMatchNumber));
    return [...set].filter(Boolean).sort(byNatural);
  }, [comp]);

  useEffect(() => {
    if (!match && matchNumbers.length) {
      const withVideo = matchNumbers.find((m) => comp.videos.some((v) => naturalNumber(v.inferredMatchNumber) === naturalNumber(m)));
      setMatch(withVideo || matchNumbers[0]);
    }
  }, [matchNumbers, match, comp.videos]);

  useEffect(() => api.ai.onEvent((ev) => {
    if (ev.job === 'film' && ev.jobId === jobId.current && ev.type === 'progress') setProgress(ev.value);
  }), []);

  useEffect(() => { setVideoError(''); setTime(0); setHidden(new Set()); }, [match]);

  const video = comp.videos.find((v) => naturalNumber(v.inferredMatchNumber) === naturalNumber(match));
  const src = video ? mediaUrl(video.url) : '';
  const scheduled = comp.schedule.find((s) => s.matchNumber === naturalNumber(match));
  const records = comp.matches.filter((m) => naturalNumber(m.matchNumber) === naturalNumber(match)).sort((a, b) => byNatural(a.teamNumber, b.teamNumber));
  const teams = useMemo(() => {
    const t = scheduled ? [...scheduled.redTeams, ...scheduled.blueTeams] : records.map((r) => r.teamNumber);
    return [...new Set(t)];
  }, [scheduled, records.length, match]);

  // Paths tagged with this match, otherwise any path we have for these teams.
  const runs = useMemo(() => {
    const exact = comp.paths.filter((p) => p.matchNumber && naturalNumber(p.matchNumber) === naturalNumber(match));
    if (exact.length) return exact;
    return comp.paths.filter((p) => teams.includes(p.teamNumber));
  }, [comp.paths, match, teams]);
  const { colors, labels } = useMemo(() => {
    const c = {};
    const l = {};
    runs.forEach((r, i) => {
      const red = scheduled?.redTeams.indexOf(r.teamNumber) ?? -1;
      const blue = scheduled?.blueTeams.indexOf(r.teamNumber) ?? -1;
      c[r.id] = red >= 0 ? RED_SHADES[red % 3] : blue >= 0 ? BLUE_SHADES[blue % 3] : ['#ffd60a', '#34d399', '#f472b6', '#60a5fa', '#fb923c', '#a78bfa'][i % 6];
      l[r.id] = r.teamNumber;
    });
    return { colors: c, labels: l };
  }, [runs, scheduled]);
  const shownRuns = runs.filter((r) => !hidden.has(r.id));

  // Smooth path playback: sample the video clock every frame, but only while it plays.
  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    const tick = () => {
      if (videoRef.current) setTime(videoRef.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, src]);

  const jump = (t) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    v.play().catch(() => {});
  };

  const download = async () => {
    if (!url.trim() || !match) return;
    setBusy(true);
    setError('');
    setProgress(0);
    jobId.current = Math.random().toString(36).slice(2);
    try {
      const file = await api.video.download({ url: url.trim(), matchNumber: match, jobId: jobId.current });
      store.setMatchVideo(match, file);
      setUrl('');
      store.toast(`Video attached to match ${match}`, 'success');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const attach = async () => {
    try {
      const file = await api.dialog.video();
      if (file) store.setMatchVideo(match, file);
    } catch (e) {
      setError(e.message);
    }
  };

  if (matchNumbers.length === 0) {
    return (
      <div className="page"><div className="page-inner">
        <PageHeader title="Film Review" subtitle="Match video alongside scouting data and robot paths" />
        <Card><Empty icon="film" title="No matches yet" body="Import scouting data or a match schedule to review film by match." action={<Button variant="primary" onClick={() => store.go('sync')}>Go to Sync</Button>} /></Card>
      </div></div>
    );
  }

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          title="Film Review"
          subtitle="Match video alongside scouting data and robot paths"
          actions={<select className="select" value={match} onChange={(e) => setMatch(e.target.value)} aria-label="Match">{matchNumbers.map((m) => <option key={m} value={m}>Match {m}</option>)}</select>}
        />

        <div className="grid-main">
          <div className="col">
            <Card>
              <div className="video-box">
                {src ? (
                  <video key={src} ref={videoRef} src={src} controls
                    onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
                    onSeeked={(e) => setTime(e.currentTarget.currentTime)} onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                    onError={() => setVideoError('This video could not be played. Try re-downloading it or use an H.264 .mp4 file.')} />
                ) : (
                  <div className="video-empty"><Icon name="film" size={34} /><div><strong>No video for match {match}</strong></div><div>Paste a link below or attach a file.</div></div>
                )}
              </div>
              {videoError && <div className="notice error" style={{ marginTop: 10 }}>{videoError}</div>}
              <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <div className="checkpoints">
                  <span className="muted">Jump to</span>
                  {CHECKPOINTS.map(([label, t]) => <Button key={label} size="sm" disabled={!src} onClick={() => jump(t)}>{label}</Button>)}
                </div>
                {video && <Button size="sm" variant="ghost" icon="trash" onClick={() => store.removeVideo(video.id)}>Remove video</Button>}
              </div>
            </Card>

            <Card title="Add video">
              <div className="row">
                <input className="input grow" placeholder="YouTube / Twitch / direct video link" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && download()} disabled={busy} />
                <Button variant="primary" icon="download" onClick={download} loading={busy} disabled={!url.trim()}>Download</Button>
                <Button icon="folder" onClick={attach} disabled={busy}>Choose file…</Button>
              </div>
              {busy && <div style={{ marginTop: 12 }}><Progress value={progress} indeterminate={!progress} label="Downloading with yt-dlp" /></div>}
              {error && <div className="notice error" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{error}</div>}
            </Card>

            <Card title="Robot paths" subtitle={runs.length ? 'Drawn up to the current video time' : undefined}
              actions={runs.length > 0 && <Segmented size="sm" value={sync ? 'sync' : 'all'} onChange={(v) => setSync(v === 'sync')} options={[{ value: 'sync', label: 'Follow video' }, { value: 'all', label: 'Full paths' }]} />}>
              {runs.length === 0 ? (
                <Empty icon="route" title="No paths for this match" body="Track this match's video in AI Trace, or import path CSVs from Sync." action={<Button onClick={() => store.go('trace')}>Open AI Trace</Button>} />
              ) : (
                <>
                  <FieldView runs={shownRuns} colors={colors} labels={labels} time={sync ? time + Number(offset || 0) : null} />
                  <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                    <div className="pill-row grow">
                      {runs.map((r) => (
                        <button key={r.id} type="button" className={`chip ${hidden.has(r.id) ? '' : 'on'}`} onClick={() => setHidden((h) => { const n = new Set(h); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}>
                          <i className="swatch" style={{ background: colors[r.id] }} /> {r.teamNumber}
                        </button>
                      ))}
                    </div>
                    {sync && <label className="row muted" style={{ gap: 6 }}>Time offset <input className="input" style={{ width: 70 }} type="number" step="0.5" value={offset} onChange={(e) => setOffset(e.target.value)} />s</label>}
                  </div>
                </>
              )}
            </Card>
          </div>

          <div className="col">
            <Card title={scheduled?.name || `Match ${match}`} subtitle={scheduled?.timeLabel}>
              {scheduled && (
                <>
                  <div className="alliance red"><b>Red</b>{scheduled.redTeams.map((t) => <button key={t} type="button" className="team-chip" onClick={() => { store.setSelectedTeam(t); store.go('teams'); }}>{t}</button>)}</div>
                  <div className="alliance blue"><b>Blue</b>{scheduled.blueTeams.map((t) => <button key={t} type="button" className="team-chip" onClick={() => { store.setSelectedTeam(t); store.go('teams'); }}>{t}</button>)}</div>
                </>
              )}
              {!scheduled && <p className="muted">This match is not in the loaded schedule.</p>}
            </Card>
            <Card title="Scouting data" subtitle={`${records.length} record${records.length === 1 ? '' : 's'}`} flush>
              {records.length === 0 ? <p className="muted pad">No scouting rows for this match.</p> : (
                <table className="table">
                  <thead><tr><th>Team</th><th>A / T</th><th>Eff</th><th>Climb</th><th className="num">Pts</th></tr></thead>
                  <tbody>
                    {records.map((m) => (
                      <React.Fragment key={m.id}>
                        <tr className="clickable" onClick={() => { store.setSelectedTeam(m.teamNumber); store.go('teams'); }}>
                          <td><strong>{m.teamNumber}</strong></td><td>{m.autoHub} / {m.teleOpHub}</td><td>{pct(shootingEfficiency(m))}</td>
                          <td>{climbLabel(m.teleOpClimb)}{m.brokeDuration ? <Badge tone="danger"> {m.brokeDuration}s down</Badge> : null}</td>
                          <td className="num"><strong>{fmt(estimatedScore(m))}</strong></td>
                        </tr>
                        {m.notes.trim() && <tr className="note-row"><td colSpan="5">{m.notes}</td></tr>}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
