import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, hasDesktop } from '../api';
import { store, useApp, useCurrent } from '../store';
import { Badge, Button, Card, Field, Icon, PageHeader } from '../components/ui';
import QrStream from '../components/QrStream';
import { framesForText } from '../lib/qrstream';
import { buildPack, phoneState, publishNow, refreshStatus, startSharing, stopSharing, subscribePhone } from '../lib/phone';

const ANDROID_URL = 'https://cliclye.github.io/packout/';

function Qr({ text }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, { margin: 1, width: 300, color: { dark: '#0b0e18', light: '#ffffff' } }).then((u) => live && setSrc(u)).catch(() => {});
    return () => { live = false; };
  }, [text]);
  return src ? <img className="qr" src={src} alt="QR code for the coach page" width="190" height="190" /> : <div className="qr" />;
}

export default function Phone() {
  const comp = useCurrent();
  const { settings } = useApp();
  const [ph, setPh] = useState(phoneState());
  const [team, setTeam] = useState((settings.myTeam || '').trim());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [stream, setStream] = useState(null); // { frames, bytes } while the QR display is open

  useEffect(() => { refreshStatus(); return subscribePhone(setPh); }, []);
  useEffect(() => setTeam((settings.myTeam || '').trim()), [settings.myTeam]);

  const saveTeam = (v) => { const n = v.replace(/\D/g, ''); setTeam(n); store.updateSettings({ myTeam: n }); };
  const run = async (key, fn) => {
    setBusy(key); setMsg('');
    try { await fn(); } catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };

  const toggle = () => run('share', () => (ph.running ? stopSharing() : startSharing()));
  const usb = () => run('usb', async () => {
    if (!ph.running) await startSharing();
    await publishNow();
    const r = await api.coach.androidUsb();
    store.toast(`Opened Packout Coach on your Android phone (${r.device})`, 'success');
  });
  const showQr = (chunk = 450) => run('qr', async () => {
    const pack = await buildPack({ refreshTba: true });
    const { frames, compressedBytes } = await framesForText(JSON.stringify(pack), { chunk });
    setStream({ frames, bytes: compressedBytes, chunk });
  });
  const exportFile = () => run('file', async () => {
    const pack = await buildPack({ refreshTba: true });
    const file = await api.dialog.save({ content: JSON.stringify(pack), defaultPath: `${comp.name.replace(/\W+/g, '_')}.packoutcoach`, filters: [{ name: 'Packout coach file', extensions: ['packoutcoach', 'json'] }] });
    if (file) store.toast('Coach file saved — AirDrop or send it to the phone', 'success');
  });
  const copy = (t) => { navigator.clipboard.writeText(t).then(() => store.toast('Link copied', 'success')); };

  const url = ph.urls[0];
  if (!hasDesktop) return <div className="page"><div className="page-inner"><PageHeader title="Phone" subtitle="Take your plan to the field" /><Card><p className="muted">Available in the desktop app.</p></Card></div></div>;

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          title="Phone"
          subtitle="Put the match plan, scores and team data on the drive coach’s phone — no laptop at the field"
          actions={ph.running ? <Badge tone="ok">Sharing on</Badge> : <Badge>Sharing off</Badge>}
        />
        {stream && <QrStream frames={stream.frames} chunk={stream.chunk} onClose={() => setStream(null)} onRebuild={showQr} />}
        {msg && <div className="notice error" style={{ marginBottom: 14, whiteSpace: 'pre-wrap' }}>{msg}</div>}
        {ph.error && !msg && <div className="notice warn" style={{ marginBottom: 14 }}>{ph.error}</div>}

        <div className="grid-2">
          <div className="col">
            <Card title="1 · Who is the drive coach planning for?">
              <Field label="Your team number" hint="The phone shows this team’s next matches, opponents and strategy.">
                <input className="input" style={{ maxWidth: 200 }} value={team} onChange={(e) => saveTeam(e.target.value)} placeholder="e.g. 1294" inputMode="numeric" />
              </Field>
            </Card>

            <Card title="2 · Send it to the phone" subtitle="Pick whatever your venue allows">
              <div className="stack">
                <div className="phone-option highlight">
                  <div>
                    <strong>QR code on screen · works with no Wi-Fi, hotspot or cable</strong>
                    <p className="muted">Shows a moving QR code. The Packout Coach app on an iPhone, or the Packout Coach web app on Android, scans it with the camera and collects all the data in about 10 seconds. Nothing touches a network.</p>
                  </div>
                  <Button variant="primary" icon="eye" loading={busy === 'qr'} onClick={() => showQr()}>Show QR code</Button>
                </div>
                <div className="phone-option">
                  <div>
                    <strong>Android · USB cable (alternative to the QR code)</strong>
                    <p className="muted">Opens the coach page on the phone through the cable — no Wi-Fi needed. Needs USB debugging and <code>adb</code> (Android platform-tools).</p>
                  </div>
                  <Button variant="primary" icon="phone" loading={busy === 'usb'} onClick={usb}>Send via USB</Button>
                </div>
                <div className="phone-option">
                  <div>
                    <strong>Wi-Fi / hotspot (practice, home — not allowed at events)</strong>
                    <p className="muted">Starts a private page on this computer. Scan the code with the phone’s camera. iPhone: join the same Wi-Fi, or turn on Personal Hotspot and plug in the cable.</p>
                  </div>
                  <Button variant={ph.running ? 'secondary' : 'primary'} icon={ph.running ? 'stop' : 'play'} loading={busy === 'share'} onClick={toggle}>{ph.running ? 'Stop sharing' : 'Start sharing'}</Button>
                </div>
                <div className="phone-option">
                  <div>
                    <strong>File · AirDrop / Files / email</strong>
                    <p className="muted">Saves a <code>.packoutcoach</code> file. Open it in the Packout Coach iPhone app (or import it in the web page) — works fully offline.</p>
                  </div>
                  <Button icon="download" loading={busy === 'file'} onClick={exportFile}>Save coach file…</Button>
                </div>
              </div>
            </Card>
          </div>

          <div className="col">
            <Card title="Live link" subtitle={ph.running ? 'Updates every 30 seconds while this is on' : 'Start sharing to get a link'}
              actions={ph.running && <Button size="sm" icon="rotate" loading={ph.busy} onClick={() => publishNow({ refreshTba: true })}>Update now</Button>}>
              {!ph.running ? (
                <div className="notice">Sharing is off. Nothing is reachable from outside this computer until you start it.</div>
              ) : !url ? (
                <div className="notice warn">No network address found. Connect this computer to Wi-Fi (or use the Android USB button).</div>
              ) : (
                <div className="phone-share">
                  <Qr text={url} />
                  <div className="stack" style={{ minWidth: 0 }}>
                    <p className="muted">Scan with the phone camera, then tap the link. Add it to the Home Screen to keep it handy.</p>
                    {ph.urls.map((u) => (
                      <div className="row" key={u} style={{ gap: 6 }}>
                        <code className="grow" style={{ wordBreak: 'break-all', fontSize: 12 }}>{u.replace(/\?k=.*/, '?k=••••')}</code>
                        <Button size="sm" variant="ghost" onClick={() => copy(u)}>Copy</Button>
                      </div>
                    ))}
                    <p className="muted" style={{ fontSize: 12 }}>{ph.lastAt ? `Last update ${new Date(ph.lastAt).toLocaleTimeString()} · ${Math.round(ph.bytes / 1024)} KB` : ''}</p>
                  </div>
                </div>
              )}
            </Card>
            <Card title="Get the iPhone app" subtitle="Packout Coach — free, on the GitHub release page">
              <div className="stack">
                <p className="muted">Download <code>PackoutCoach-…-unsigned.ipa</code> from the latest release and install it with <b>Sideloadly</b> or <b>AltStore</b> (free, uses your own Apple ID; re-install every 7 days). Do this at home — it needs internet. At the event you only need the app and a camera.</p>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <Button icon="external" onClick={() => api.shell.openExternal('https://github.com/cliclye/packout/releases/latest')}>Open download page</Button>
                  <Button variant="ghost" icon="external" onClick={() => api.shell.openExternal('https://sideloadly.io')}>Sideloadly</Button>
                </div>
              </div>
            </Card>
            <Card title="Get the Android app" subtitle="Packout Coach web app — installs from Chrome, then works offline">
              <div className="phone-share">
                <Qr text={ANDROID_URL} />
                <div className="stack" style={{ minWidth: 0 }}>
                  <p className="muted">On the phone scan this, open the page in Chrome, then <b>⋮ → Install app</b> (or Add to Home screen). Do it at home — it needs internet once. After that it opens offline and its <b>📷 Scan</b> button reads the QR code from this screen. Works the same from a Windows or Mac computer.</p>
                  <div className="row" style={{ gap: 6 }}><code className="grow" style={{ wordBreak: 'break-all', fontSize: 12 }}>{ANDROID_URL}</code><Button size="sm" variant="ghost" onClick={() => copy(ANDROID_URL)}>Copy</Button></div>
                </div>
              </div>
            </Card>
            <Card title="How it stays safe">
              <ul className="insight-list good">
                <li><Icon name="check" size={15} />Only phones with the secret link can read the data, and only while sharing is on.</li>
                <li><Icon name="check" size={15} />The QR method uses no network at all. Wi-Fi sharing stays on your local network. Nothing goes to the internet.</li>
                <li><Icon name="check" size={15} />The phone keeps its last copy, so it still works if the connection drops mid-match.</li>
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
