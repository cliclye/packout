import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, hasDesktop, mediaUrl } from '../api';
import { store, useApp, useCurrent } from '../store';
import { Badge, Button, Card, Empty, Field, Icon, LogBox, PageHeader, Progress, Segmented, Stat, confirmDialog, fmt } from '../components/ui';
import Calibration from '../components/Calibration';
import FieldView, { FieldLegend } from '../components/FieldView';
import { resamplePath } from '../../shared/pathData';
import { byNatural } from '../../shared/models';

const STEPS = [
  { id: 'source', label: 'Source' },
  { id: 'process', label: 'Download & detect' },
  { id: 'track', label: 'Calibrate & track' },
  { id: 'review', label: 'Review & import' },
];

const DEFAULT_CAL = {
  topLeft: { x: 0.1935, y: 0.2117 },
  bottomLeft: { x: 0, y: 0.6862 },
  topRight: { x: 0.8559, y: 0.2551 },
  bottomRight: { x: 1, y: 0.6786 },
};
const ROBOT_COLORS = ['#ff5a5f', '#ff9f5f', '#ffd25f', '#4d8dff', '#4dd4ff', '#a78bfa'];
const emptyJob = { busy: false, value: 0, detail: '', log: [], error: '' };

const when = (iso) => {
  try {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
};

function Stepper({ step, reach, onGo }) {
  const idx = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="stepper">
      {STEPS.map((s, i) => (
        <React.Fragment key={s.id}>
          <div className={`step ${i === idx ? 'current' : i < idx ? 'done' : ''} ${i <= reach ? 'clickable' : ''}`} onClick={() => i <= reach && onGo(s.id)}>
            <span className="bubble">{i < idx ? <Icon name="check" size={14} /> : i + 1}</span>
            <span>{s.label}</span>
          </div>
          {i < STEPS.length - 1 && <div className={`step-line ${i < idx ? 'done' : ''}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function ToolRow({ ok, title, detail, action }) {
  return (
    <div className="tool-row">
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      {ok ? <span className="tool-state ok"><Icon name="check" size={15} /> Ready</span> : action || <span className="tool-state bad"><Icon name="alert" size={15} /> Needs attention</span>}
    </div>
  );
}

export default function Trace() {
  const comp = useCurrent();
  const { settings } = useApp();
  const [runs, setRuns] = useState([]);
  const [run, setRun] = useState(null);
  const [step, setStep] = useState('source');
  const [tools, setTools] = useState(null);
  const [jobs, setJobs] = useState({ setup: emptyJob, download: emptyJob, detect: emptyJob });
  const runIdRef = useRef(null);
  runIdRef.current = run?.id || null;

  // source form
  const [srcType, setSrcType] = useState('url');
  const [url, setUrl] = useState('');
  const [filePath, setFilePath] = useState('');
  const [detJson, setDetJson] = useState('');
  const [detCover, setDetCover] = useState('');
  const [matchLabel, setMatchLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [sourceError, setSourceError] = useState('');

  // tracking form
  const [slots, setSlots] = useState(['', '', '', '', '', '']);
  const [redOnLeft, setRedOnLeft] = useState(settings.redOnLeft !== false);
  const [teleop, setTeleop] = useState('');
  const [corners, setCorners] = useState(settings.fieldCalibration || DEFAULT_CAL);
  const [tracking, setTracking] = useState(false);
  const [trackError, setTrackError] = useState('');
  const [manual, setManual] = useState(null); // {left:[], right:[], message}
  const [coverBust, setCoverBust] = useState(0);
  const [calibTouched, setCalibTouched] = useState(false);

  // results
  const [result, setResult] = useState(null);
  const [filter, setFilter] = useState('both');
  const [viewMode, setViewMode] = useState('paths');
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return undefined;
    const onKey = (e) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);
  const [hidden, setHidden] = useState(() => new Set());
  const [imported, setImported] = useState(false);

  const matchNumbers = useMemo(() => {
    const set = new Set([...comp.matches.map((m) => m.matchNumber), ...comp.schedule.map((s) => String(s.matchNumber))]);
    return [...set].filter(Boolean).sort(byNatural);
  }, [comp]);

  const patchJob = useCallback((name, patch) => setJobs((j) => ({ ...j, [name]: { ...j[name], ...(typeof patch === 'function' ? patch(j[name]) : patch) } })), []);

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await api.ai.runs());
    } catch (e) {
      console.error(e);
    }
  }, []);
  const refreshTools = useCallback(async () => {
    try {
      setTools(await api.tools.status());
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => { refreshRuns(); refreshTools(); }, [refreshRuns, refreshTools]);

  useEffect(
    () =>
      api.ai.onEvent((ev) => {
        if (ev.job === 'setup') {
          patchJob('setup', (j) => (ev.type === 'log' ? { log: [...j.log, ev.message].slice(-200) } : {}));
        } else if (ev.runId && ev.runId === runIdRef.current && (ev.job === 'download' || ev.job === 'detect')) {
          if (ev.type === 'progress') patchJob(ev.job, { value: ev.value, detail: ev.detail || '' });
          else if (ev.type === 'log') patchJob(ev.job, (j) => ({ log: [...j.log, ev.message].slice(-200) }));
        }
      }),
    [patchJob]
  );

  // Calibration persisted with the run beats the last-used global one.
  const openRun = useCallback(
    (r) => {
      setRun(r);
      setResult(null);
      setImported(false);
      setManual(null);
      setTrackError('');
      setHidden(new Set());
      setJobs((j) => ({ ...j, download: emptyJob, detect: emptyJob }));
      setCalibTouched(Boolean(r.calibration || settings.fieldCalibration));
      if (r.calibration) setCorners(r.calibration);
      else if (settings.fieldCalibration) setCorners(settings.fieldCalibration);
      if (r.teams) setSlots(r.teams);
      else setSlots(['', '', '', '', '', '']);
      if (typeof r.redOnLeft === 'boolean') setRedOnLeft(r.redOnLeft);
      setTeleop(r.teleopStart ? String(r.teleopStart) : '');
      setMatchLabel(r.matchNumber || '');
      setStep(r.hasDetections ? 'track' : 'process');
    },
    [settings.fieldCalibration]
  );

  const reloadRun = async (id) => {
    const fresh = await api.ai.run(id);
    setRun(fresh);
    refreshRuns();
    return fresh;
  };

  // Prefill alliances from the schedule when the user hasn't typed any.
  useEffect(() => {
    if (!run || slots.some((s) => s)) return;
    const sched = comp.schedule.find((s) => String(s.matchNumber) === String(matchLabel || run.matchNumber).replace(/\D/g, ''));
    if (!sched) return;
    const left = redOnLeft ? sched.redTeams : sched.blueTeams;
    const right = redOnLeft ? sched.blueTeams : sched.redTeams;
    setSlots([...left, ...right].map(String));
  }, [run?.id, matchLabel, redOnLeft]);

  const needsEnv = tools && !tools.env.ready;

  // ---- actions -----------------------------------------------------------

  const create = async () => {
    setSourceError('');
    setCreating(true);
    try {
      let r;
      if (srcType === 'url') {
        if (!/^https?:\/\//i.test(url.trim())) throw new Error('Paste a full http(s) video link.');
        r = await api.ai.create({ label: `Match ${matchLabel || 'video'}`, matchNumber: matchLabel, sourceType: 'url', source: url.trim() });
      } else if (srcType === 'file') {
        if (!filePath) throw new Error('Choose a video file first.');
        r = await api.ai.create({ label: `Match ${matchLabel || 'video'}`, matchNumber: matchLabel, sourceType: 'file', source: filePath });
      } else {
        if (!detJson) throw new Error('Choose a detections file (output.json) first.');
        r = await api.ai.importDetections({ jsonPath: detJson, coverPath: detCover || undefined, videoPath: filePath || undefined, label: `Match ${matchLabel || 'detections'}`, matchNumber: matchLabel });
      }
      await refreshRuns();
      openRun(r);
    } catch (e) {
      setSourceError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const runJob = async (name, fn) => {
    patchJob(name, { busy: true, value: 0, detail: '', log: [], error: '' });
    try {
      await fn();
      patchJob(name, { busy: false, value: 1 });
      return true;
    } catch (e) {
      patchJob(name, { busy: false, error: e.message });
      return false;
    }
  };

  const doSetup = async () => {
    const ok = await runJob('setup', () => api.ai.setup());
    await refreshTools();
    if (ok) store.toast('AI environment installed', 'success');
  };
  const doDownload = async () => {
    const ok = await runJob('download', () => api.ai.download(run.id));
    if (ok) await reloadRun(run.id);
  };
  const doDetect = async () => {
    const ok = await runJob('detect', () => api.ai.detect(run.id));
    if (ok) {
      const fresh = await reloadRun(run.id);
      setCoverBust(Date.now());
      store.toast('Detection finished', 'success');
      setStep('track');
      return fresh;
    }
    return null;
  };
  const cancel = () => api.ai.cancel().catch(() => {});

  const removeRun = async (r) => {
    const ok = await confirmDialog({ title: 'Delete this analysis?', message: 'The downloaded video and detections for this analysis are removed from disk. Paths already imported into the competition are kept.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await api.ai.remove(r.id);
    if (run?.id === r.id) { setRun(null); setStep('source'); }
    refreshRuns();
  };

  const teamList = slots.map((s) => s.trim());
  const slotErrors = teamList.map((t) => (t === '' ? 'required' : t === 'no_show' || /^[0-9A-Za-z]{1,6}$/.test(t) ? '' : 'invalid'));
  const showing = teamList.filter((t) => t && t !== 'no_show').length;
  const canTrack = slotErrors.every((e) => !e) && showing > 0 && !tracking;

  const track = async (manualStarts) => {
    setTrackError('');
    setTracking(true);
    try {
      const params = { teams: teamList, calibration: corners, teleopStart: Number(teleop) || 0, redOnLeft, manualStarts: manualStarts || null };
      const res = await api.ai.track(run.id, params);
      await api.ai.update(run.id, { calibration: corners, teams: teamList, redOnLeft, teleopStart: Number(teleop) || 0, matchNumber: matchLabel });
      store.updateSettings({ fieldCalibration: corners, redOnLeft });
      if (!res.ok && res.needsManualStart) {
        setManual({ left: Array(res.leftShows).fill(''), right: Array(res.rightShows).fill(''), message: res.message });
        return;
      }
      setManual(null);
      setResult(res);
      setHidden(new Set());
      setImported(false);
      setStep('review');
      refreshRuns();
    } catch (e) {
      setTrackError(e.message);
    } finally {
      setTracking(false);
    }
  };

  const submitManual = () => {
    const toNums = (a) => a.map((v) => parseFloat(v));
    track({ left: toNums(manual.left), right: toNums(manual.right) });
  };

  const resampled = useMemo(
    () => (result ? result.robots.map((r, i) => ({ id: `ai:${run.id}:${r.team}`, teamNumber: r.team, matchNumber: matchLabel, source: 'ai', samples: resamplePath(r.history), raw: r.history.length, color: ROBOT_COLORS[i % ROBOT_COLORS.length] })) : []),
    [result, matchLabel, run?.id]
  );
  const colors = useMemo(() => Object.fromEntries(resampled.map((r) => [r.id, r.color])), [resampled]);
  const labels = useMemo(() => Object.fromEntries(resampled.map((r) => [r.id, r.teamNumber])), [resampled]);

  const doImport = () => {
    const toImport = resampled.filter((r) => r.samples.length > 1 && !hidden.has(r.id));
    if (!toImport.length) return store.toast('Nothing to import — every robot is hidden or has no path.', 'warn');
    store.addPathRuns(toImport.map(({ raw, color, ...rest }) => rest), `AI trace imported: ${toImport.length} robot path(s)${matchLabel ? ` for match ${matchLabel}` : ''}`);
    api.ai.update(run.id, { matchNumber: matchLabel }).catch(() => {});
    setImported(true);
    store.toast(`Imported ${toImport.length} path${toImport.length === 1 ? '' : 's'} into ${comp.name}`, 'success');
  };

  const exportCsvs = async () => {
    try {
      const dirs = await api.dialog.folders();
      if (!dirs.length) return;
      const files = await api.ai.saveCsv({ robots: result.robots, dir: dirs[0] });
      store.toast(`Wrote ${files.length} CSV file${files.length === 1 ? '' : 's'} (AIScout format)`, 'success');
    } catch (e) {
      store.toast(e.message, 'error');
    }
  };

  // Calibration preview frame: detector's cover.png, else the saved frame.
  const coverSrc = run?.coverPath ? `${mediaUrl(run.coverPath)}?v=${coverBust}` : '';
  const captureFrame = useCallback(async () => {
    if (!run?.videoExists) return;
    const v = document.createElement('video');
    v.muted = true;
    v.src = mediaUrl(run.videoPath);
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('Could not read the video to make a preview frame.')); });
    v.currentTime = Math.min(10, (v.duration || 20) / 2);
    await new Promise((res) => { v.onseeked = res; });
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const fresh = await api.ai.setCover(run.id, c.toDataURL('image/png'));
    setRun(fresh);
    setCoverBust(Date.now());
  }, [run?.id, run?.videoExists, run?.videoPath]);

  useEffect(() => {
    if (step === 'track' && run && !run.coverPath && run.videoExists) captureFrame().catch(() => {});
  }, [step, run?.id, run?.coverPath, run?.videoExists]);

  if (!hasDesktop) {
    return (
      <div className="page"><div className="page-inner">
        <PageHeader title="AI Trace" subtitle="Track robot paths from match video" />
        <Card><Empty icon="route" title="Desktop app required" body="Video download, detection and tracking run on your computer through the Packout desktop app." /></Card>
      </div></div>
    );
  }

  const reach = !run ? 0 : result ? 3 : run.hasDetections ? 2 : 1;
  const dl = jobs.download;
  const det = jobs.detect;
  const setup = jobs.setup;

  // ---- render ------------------------------------------------------------

  const sourcePanel = (
    <Card title="New analysis" subtitle="Where should the match footage come from?">
      <div className="stack">
        <Segmented value={srcType} onChange={setSrcType} options={[{ value: 'url', label: 'Video link' }, { value: 'file', label: 'Video file' }, { value: 'detections', label: 'Existing detections' }]} />
        {srcType === 'url' && (
          <Field label="Match video link" hint="YouTube, Twitch or a direct video URL. A wide, high-angle view of the whole field works best.">
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" spellCheck={false} />
          </Field>
        )}
        {srcType === 'file' && (
          <Field label="Video file">
            <div className="row">
              <input className="input grow" readOnly value={filePath} placeholder="No file chosen" />
              <Button icon="folder" onClick={async () => { const f = await api.dialog.video().catch(() => null); if (f) setFilePath(f); }}>Choose…</Button>
            </div>
          </Field>
        )}
        {srcType === 'detections' && (
          <>
            <div className="notice">Already ran the detector (for example with the scouting-ai tool)? Load its <code>temp/output.json</code> to skip straight to tracking.</div>
            <Field label="Detections file (output.json)">
              <div className="row">
                <input className="input grow" readOnly value={detJson} placeholder="No file chosen" />
                <Button icon="folder" onClick={async () => { const f = await api.dialog.open([{ name: 'JSON', extensions: ['json'] }], 'Choose detector output.json').catch(() => null); if (f) setDetJson(f); }}>Choose…</Button>
              </div>
            </Field>
            <Field label="Preview frame (optional)" hint="matches/cover.png from the detector. Used for the calibration screen.">
              <div className="row">
                <input className="input grow" readOnly value={detCover} placeholder="No file chosen" />
                <Button icon="camera" onClick={async () => { const f = await api.dialog.open([{ name: 'Image', extensions: ['png', 'jpg', 'jpeg'] }], 'Choose a preview frame').catch(() => null); if (f) setDetCover(f); }}>Choose…</Button>
              </div>
            </Field>
          </>
        )}
        <Field label="Match number" hint="Used to label the imported paths and pre-fill the alliances from the schedule.">
          <input className="input" list="trace-matches" value={matchLabel} onChange={(e) => setMatchLabel(e.target.value)} placeholder="e.g. 12" />
          <datalist id="trace-matches">{matchNumbers.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        {sourceError && <div className="notice error">{sourceError}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="primary" icon="arrowRight" loading={creating} onClick={create}>Continue</Button>
        </div>
      </div>
    </Card>
  );

  const processPanel = run && (
    <div className="col">
      <Card title="AI environment" subtitle="One-time setup for the Roboflow detector">
        <ToolRow ok={tools?.python?.ok} title="Python 3.9 – 3.12" detail={tools?.python?.ok ? `${tools.python.version} · ${tools.python.path}` : tools?.python?.message || 'Checking…'} />
        <ToolRow
          ok={tools?.env?.ready}
          title="Detector packages"
          detail={tools?.env?.ready ? 'inference, supervision, OpenCV installed' : 'Installs into a private environment inside Packout’s data folder (a few hundred MB).'}
          action={<Button size="sm" variant="primary" loading={setup.busy} disabled={!tools?.python?.ok} onClick={doSetup}>Install</Button>}
        />
        <ToolRow ok={tools?.roboflowKey} title="Roboflow API key" detail={tools?.roboflowKey ? 'Saved in Settings' : 'Required to run the robot detection model.'} action={<Button size="sm" onClick={() => store.go('settings')}>Add key</Button>} />
        {run.sourceType === 'url' && <ToolRow ok={Boolean(tools?.ytdlp)} title="yt-dlp" detail={tools?.ytdlp || 'macOS: brew install yt-dlp · Windows: winget install yt-dlp'} action={<Button size="sm" onClick={refreshTools}>Re-check</Button>} />}
        {(setup.busy || setup.log.length > 0 || setup.error) && (
          <div className="stack" style={{ marginTop: 12 }}>
            {setup.busy && <Progress indeterminate label="Installing packages…" />}
            <LogBox lines={setup.log} height={140} />
            {setup.error && <div className="notice error" style={{ whiteSpace: 'pre-wrap' }}>{setup.error}</div>}
            {setup.busy && <Button size="sm" onClick={cancel}>Cancel</Button>}
          </div>
        )}
      </Card>

      {run.sourceType === 'url' && (
        <Card title="1 · Download video" subtitle="720p, same settings as the scouting-ai downloader">
          <div className="stack">
            {run.videoExists ? (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="tool-state ok"><Icon name="check" size={15} /> Downloaded</span>
                <Button size="sm" variant="ghost" loading={dl.busy} onClick={doDownload}>Download again</Button>
              </div>
            ) : (
              <>
                <code style={{ wordBreak: 'break-all' }}>{run.source}</code>
                {dl.busy ? <Progress value={dl.value} indeterminate={!dl.value} label="Downloading" /> : <div><Button variant="primary" icon="download" onClick={doDownload}>Download video</Button></div>}
              </>
            )}
            {dl.busy && <Button size="sm" onClick={cancel}>Cancel</Button>}
            {dl.error && <div className="notice error" style={{ whiteSpace: 'pre-wrap' }}>{dl.error}</div>}
          </div>
        </Card>
      )}

      <Card title={`${run.sourceType === 'url' ? '2' : '1'} · Detect robots`} subtitle="Runs your Roboflow model on every frame — this can take a while on long videos">
        <div className="stack">
          {run.hasDetections && !det.busy ? (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="tool-state ok"><Icon name="check" size={15} /> Detections ready ({(run.detectionsBytes / 1048576).toFixed(1)} MB)</span>
              <div className="row">
                {run.videoExists && <Button size="sm" variant="ghost" onClick={doDetect} disabled={!tools?.env?.ready || !tools?.roboflowKey}>Re-run</Button>}
                <Button size="sm" variant="primary" icon="arrowRight" onClick={() => setStep('track')}>Continue</Button>
              </div>
            </div>
          ) : det.busy ? (
            <>
              <Progress value={det.value} indeterminate={!det.value} label="Detecting robots" detail={det.detail} />
              <Button size="sm" onClick={cancel}>Cancel</Button>
            </>
          ) : (
            <div>
              <Button variant="primary" icon="cpu" onClick={doDetect} disabled={!run.videoExists || !tools?.env?.ready || !tools?.roboflowKey}>Run detection</Button>
              {!run.videoExists && <span className="muted" style={{ marginLeft: 12 }}>Download the video first.</span>}
              {run.videoExists && needsEnv && <span className="muted" style={{ marginLeft: 12 }}>Install the detector packages above first.</span>}
            </div>
          )}
          {(det.log.length > 0 || det.busy) && <LogBox lines={det.log} height={120} />}
          {det.error && <div className="notice error" style={{ whiteSpace: 'pre-wrap' }}>{det.error}</div>}
        </div>
      </Card>
    </div>
  );

  const slotCard = (title, color, offset) => (
    <div className={`alliance-box ${color}`}>
      <h4>{title}</h4>
      <div className="team-inputs">
        {[0, 1, 2].map((i) => {
          const idx = offset + i;
          const noShow = slots[idx].trim() === 'no_show';
          return (
            <div className="slot" key={i}>
              <span>{i + 1}</span>
              <div className="row">
                <input className="input grow" style={slotErrors[idx] === 'invalid' ? { borderColor: 'var(--danger)' } : null} value={noShow ? 'no_show' : slots[idx]} disabled={noShow} placeholder={i === 0 ? 'closest to camera' : i === 2 ? 'furthest' : ''} onChange={(e) => setSlots((s) => s.map((v, j) => (j === idx ? e.target.value : v)))} />
                <label className="check" title="This team did not play"><input type="checkbox" checked={noShow} onChange={(e) => setSlots((s) => s.map((v, j) => (j === idx ? (e.target.checked ? 'no_show' : '') : v)))} /><span className="muted" style={{ fontSize: 12 }}>no-show</span></label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const trackPanel = run && (
    <div className="grid-main">
      <Card title="Field calibration" subtitle="Drag the yellow dots onto the four corners of the field" actions={<div className="row"><Button size="sm" variant="ghost" onClick={() => { setCorners(DEFAULT_CAL); setCalibTouched(false); }}>Reset</Button>{!run.coverPath && run.videoExists && <Button size="sm" icon="camera" onClick={() => captureFrame().catch((e) => setTrackError(e.message))}>Grab frame</Button>}</div>}>
        <Calibration imageSrc={coverSrc} corners={corners} onChange={(c) => { setCorners(c); setCalibTouched(true); }} redOnLeft={redOnLeft} />
        {!coverSrc && <div className="notice warn" style={{ marginTop: 10 }}>No preview frame is available for this analysis. Attach a video (or re-run detection) to calibrate visually — the saved calibration is used meanwhile.</div>}
        <p className="muted" style={{ marginTop: 10 }}>Corners are the field’s far-left, near-left, far-right and near-right corners as they appear in the video. The green outline should hug the carpet area, and the alliance labels should match the sides in the video.</p>
      </Card>
      <div className="col">
        <Card title="Alliances">
          <div className="stack">
            <Field label="Which alliance is on the left side of the video?">
              <Segmented value={redOnLeft ? 'red' : 'blue'} onChange={(v) => setRedOnLeft(v === 'red')} options={[{ value: 'red', label: 'Red on left' }, { value: 'blue', label: 'Blue on left' }]} />
            </Field>
            {slotCard('Left side', redOnLeft ? 'red' : 'blue', 0)}
            {slotCard('Right side', redOnLeft ? 'blue' : 'red', 3)}
            <p className="muted">List each side from the robot closest to the camera to the furthest. Mark robots that did not play as no-show.</p>
          </div>
        </Card>
        <Card title="Match timing">
          <Field label="Teleop starts at (video seconds)" hint="Leave blank to rely on the detector’s Auto/Robot classes. Frames before this time are treated as autonomous.">
            <input className="input" type="number" min="0" value={teleop} onChange={(e) => setTeleop(e.target.value)} placeholder="e.g. 25" style={{ maxWidth: 160 }} />
          </Field>
        </Card>
        {manual && (
          <Card title="Enter starting positions">
            <div className="stack">
              <div className="notice warn">{manual.message}</div>
              {['left', 'right'].map((side) => (
                <Field key={side} label={`${side === 'left' ? 'Left' : 'Right'} side — Y positions, 0 = far wall, 1 = near wall`}>
                  <div className="row">{manual[side].map((v, i) => <input key={i} className="input" type="number" step="0.05" min="0" max="1" value={v} onChange={(e) => setManual((m) => ({ ...m, [side]: m[side].map((x, j) => (j === i ? e.target.value : x)) }))} />)}</div>
                </Field>
              ))}
              <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="primary" onClick={submitManual} loading={tracking}>Track with these starts</Button></div>
            </div>
          </Card>
        )}
        {!calibTouched && <div className="notice warn">The field outline is still at its default position. Drag the four yellow dots onto this video’s field corners first — tracking quality depends on it.</div>}
        {trackError && <div className="notice error">{trackError}</div>}
        <Button variant="primary" icon="route" loading={tracking} disabled={!canTrack} onClick={() => track()}>Track robots</Button>
      </div>
    </div>
  );

  const reviewPanel = run && result && (
    <div className={full ? 'review-full' : 'grid-main'}>
      <Card className={full ? 'review-field' : ''} title={viewMode === 'heat' ? 'Where the robots spend time' : 'Tracked paths'} subtitle={`Started from frame ${result.firstFrameIndex} (${result.startPercent}% into the video)${result.autoStartFound ? '' : ' · manual starting positions'}`}
        actions={
          <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Segmented size="sm" value={viewMode} onChange={setViewMode} options={[{ value: 'paths', label: 'Paths' }, { value: 'heat', label: 'Heatmap' }]} />
            <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: 'both', label: 'All' }, { value: 'auto', label: 'Auto' }, { value: 'tele', label: 'Teleop' }]} />
            <Button size="sm" icon={full ? 'x' : 'eye'} onClick={() => setFull(!full)}>{full ? 'Exit full screen' : 'Full screen'}</Button>
          </div>
        }>
        <FieldView runs={resampled.filter((r) => !hidden.has(r.id))} colors={colors} labels={labels} filter={filter} mode={viewMode} />
        <FieldLegend mode={viewMode} />
        {viewMode === 'heat' && hidden.size < resampled.length && <p className="muted" style={{ marginTop: 6 }}>Combined time spent by {resampled.length - hidden.size} selected robot{resampled.length - hidden.size === 1 ? '' : 's'}. Toggle robots on the right to compare.</p>}
      </Card>
      <div className="col">
        <Card title="Robots">
          <div className="list">
            {resampled.map((r) => {
              const dur = r.samples.length ? r.samples[r.samples.length - 1].time - r.samples[0].time : 0;
              const off = hidden.has(r.id);
              return (
                <button key={r.id} type="button" className={`run-row ${off ? '' : 'selected'}`} onClick={() => setHidden((h) => { const n = new Set(h); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}>
                  <span className="row"><i className="swatch" style={{ background: r.color }} /><strong>Team {r.teamNumber}</strong></span>
                  <span className="muted">{r.raw} samples · {fmt(dur, 0)}s</span>
                </button>
              );
            })}
          </div>
          {resampled.some((r) => r.raw < 60) && <div className="notice warn" style={{ marginTop: 10 }}>One or more robots have very little data. Check the calibration and the team order, then track again.</div>}
        </Card>
        <Card title="Import">
          <div className="stack">
            <Field label="Match number">
              <input className="input" list="trace-matches" value={matchLabel} onChange={(e) => { setMatchLabel(e.target.value); setImported(false); }} placeholder="e.g. 12" />
            </Field>
            {imported ? (
              <div className="notice ok">Imported into {comp.name}. Open <button type="button" className="link-btn" onClick={() => store.go('film')}>Film Review</button> or a team’s profile to see it.</div>
            ) : null}
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <Button variant="primary" icon="check" onClick={doImport}>{imported ? 'Import again' : `Import into ${comp.name.length > 22 ? 'competition' : comp.name}`}</Button>
              <Button icon="file" onClick={exportCsvs}>Export CSVs…</Button>
              <Button variant="ghost" icon="arrowLeft" onClick={() => setStep('track')}>Adjust</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          title="AI Trace"
          subtitle="Turn match video into robot paths — same tracker as scouting-ai"
          actions={<Button icon="plus" onClick={() => { setRun(null); setStep('source'); setResult(null); setUrl(''); setFilePath(''); setDetJson(''); setDetCover(''); setMatchLabel(''); }}>New analysis</Button>}
        />
        <div className="split" style={{ gridTemplateColumns: '260px minmax(0, 1fr)' }}>
          <div className="col">
            <Card title="Analyses" flush>
              <div className="list" style={{ padding: '0 10px 12px' }}>
                {runs.length === 0 && <p className="muted pad">None yet.</p>}
                {runs.map((r) => (
                  <div key={r.id} className={`run-row ${run?.id === r.id ? 'selected' : ''}`} onClick={() => openRun(r)} role="button" tabIndex={0}>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label || r.id}</strong>
                      <small className="muted">{when(r.createdAt)}</small>
                      <span className="pill-row" style={{ marginTop: 4 }}>
                        {r.videoExists && <Badge>video</Badge>}
                        {r.hasDetections && <Badge tone="accent">detected</Badge>}
                        {r.tracked && <Badge tone="ok">tracked</Badge>}
                      </span>
                    </span>
                    <button type="button" className="icon-btn" title="Delete" onClick={(e) => { e.stopPropagation(); removeRun(r); }}><Icon name="trash" size={15} /></button>
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <div>
            <Stepper step={step} reach={reach} onGo={setStep} />
            {step === 'source' && sourcePanel}
            {step === 'process' && (processPanel || sourcePanel)}
            {step === 'track' && (trackPanel || sourcePanel)}
            {step === 'review' && (reviewPanel || sourcePanel)}
          </div>
        </div>
      </div>
    </div>
  );
}
