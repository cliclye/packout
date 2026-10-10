import React, { useEffect, useState } from 'react';
import { api, hasDesktop } from '../api';
import { store, useApp } from '../store';
import { Badge, Button, Card, Field, Icon, PageHeader, Segmented } from '../components/ui';

/** Text/secret setting that saves when the field loses focus. */
function SettingInput({ name, label, hint, type = 'text', placeholder, mono = false }) {
  const { settings } = useApp();
  const [value, setValue] = useState(settings[name] || '');
  const [show, setShow] = useState(false);
  useEffect(() => setValue(settings[name] || ''), [settings[name]]);
  const commit = () => {
    if ((settings[name] || '') !== value.trim()) store.updateSettings({ [name]: value.trim() }).then(() => store.toast('Saved', 'success'));
  };
  return (
    <Field label={label} hint={hint}>
      <div className="row">
        <input className={`input ${mono ? 'mono' : ''}`} type={type === 'secret' && !show ? 'password' : 'text'} value={value} placeholder={placeholder} spellCheck={false} autoComplete="off" onChange={(e) => setValue(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        {type === 'secret' && <button type="button" className="icon-btn" title={show ? 'Hide' : 'Show'} onClick={() => setShow(!show)}><Icon name="eye" size={16} /></button>}
      </div>
    </Field>
  );
}

function ToolRow({ title, ok, detail }) {
  return (
    <div className="tool-row">
      <div><strong>{title}</strong><small>{detail}</small></div>
      <span className={`tool-state ${ok ? 'ok' : 'bad'}`}><Icon name={ok ? 'check' : 'alert'} size={15} />{ok ? 'Found' : 'Not found'}</span>
    </div>
  );
}

export default function Settings() {
  const { settings } = useApp();
  const [tools, setTools] = useState(null);
  const check = () => api.tools.status().then(setTools).catch(() => {});
  useEffect(() => { check(); }, []);

  const pickCookies = async () => {
    try {
      const f = await api.dialog.open([{ name: 'Cookies', extensions: ['txt', '*'] }], 'Choose a cookies.txt file');
      if (f) store.updateSettings({ ytdlpCookiesFile: f });
    } catch (e) {
      store.toast(e.message, 'error');
    }
  };

  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 860 }}>
        <PageHeader title="Settings" subtitle="Appearance, API keys and tools" />
        <div className="col">
          <Card title="Appearance">
            <Segmented value={settings.theme || 'system'} onChange={(theme) => store.updateSettings({ theme })} options={[{ value: 'system', label: 'Match system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          </Card>

          <Card title="Blue Alliance" subtitle="Event lists and match schedules">
            <SettingInput name="tbaApiKey" type="secret" label="Read API key" hint="Create one at thebluealliance.com/account → Read API keys." placeholder="TBA auth key" />
            <p style={{ marginTop: 8 }}><button type="button" className="link-btn" onClick={() => api.shell.openExternal('https://www.thebluealliance.com/account')}>Open thebluealliance.com/account →</button></p>
          </Card>

          <Card title="AI path tracing" subtitle="Robot detection with Roboflow">
            <div className="stack">
              <SettingInput name="roboflowApiKey" type="secret" label="Roboflow API key" hint="Private key from roboflow.com → Settings → API Keys. Used to run the robot detection model." placeholder="Roboflow private API key" />
              <SettingInput name="pythonPath" label="Python executable (optional)" hint="Leave blank to auto-detect Python 3.9–3.12." placeholder="/opt/homebrew/bin/python3.12" mono />
              <div className="grid-2" style={{ gap: 12 }}>
                <Field label="YouTube sign-in" hint="Lets yt-dlp use your browser login when YouTube blocks downloads.">
                  <select className="select" style={{ width: '100%' }} value={settings.ytdlpCookiesBrowser || ''} onChange={(e) => store.updateSettings({ ytdlpCookiesBrowser: e.target.value })}>
                    <option value="">Don’t use browser cookies</option>
                    {['chrome', 'safari', 'firefox', 'edge', 'brave'].map((b) => <option key={b} value={b}>Use cookies from {b[0].toUpperCase() + b.slice(1)}</option>)}
                  </select>
                </Field>
                <Field label="…or a cookies.txt file" hint={settings.ytdlpCookiesFile || 'No file chosen'}>
                  <div className="row"><Button onClick={pickCookies}>Choose…</Button>{settings.ytdlpCookiesFile && <Button variant="ghost" onClick={() => store.updateSettings({ ytdlpCookiesFile: '' })}>Clear</Button>}</div>
                </Field>
              </div>
            </div>
          </Card>

          <Card title="Picklist assistant" subtitle="Optional — chat about your picklist with a language model">
            <div className="stack">
              <Field label="Provider">
                <Segmented value={settings.llmProvider || 'openai'} onChange={(llmProvider) => store.updateSettings({ llmProvider })} options={[{ value: 'openai', label: 'OpenAI' }, { value: 'anthropic', label: 'Anthropic' }]} />
              </Field>
              <SettingInput name="llmApiKey" type="secret" label="API key" placeholder={settings.llmProvider === 'anthropic' ? 'sk-ant-…' : 'sk-…'} hint="Stored only on this computer. Requests are sent straight from Packout to the provider." />
              <div className="grid-2" style={{ gap: 12 }}>
                <SettingInput name="openaiModel" label="OpenAI model" mono />
                <SettingInput name="anthropicModel" label="Anthropic model" mono />
              </div>
            </div>
          </Card>

          <Card title="Tools on this computer" actions={<Button size="sm" variant="ghost" icon="rotate" onClick={check}>Re-check</Button>}>
            {!hasDesktop ? <p className="muted">Available in the desktop app.</p> : !tools ? <p className="muted">Checking…</p> : (
              <>
                <ToolRow title="Python 3.9–3.12" ok={tools.python?.ok} detail={tools.python?.ok ? `${tools.python.version} · ${tools.python.path}` : tools.python?.message} />
                <ToolRow title="AI detector packages" ok={tools.env?.ready} detail={tools.env?.ready ? 'Installed' : 'Install from the AI Trace page'} />
                <ToolRow title="yt-dlp" ok={Boolean(tools.ytdlp)} detail={tools.ytdlp || 'brew install yt-dlp'} />
                <ToolRow title="ffmpeg" ok={Boolean(tools.ffmpeg)} detail={tools.ffmpeg || 'Optional — merges separate audio/video streams (brew install ffmpeg)'} />
                <ToolRow title="adb (Android platform-tools)" ok={Boolean(tools.adb)} detail={tools.adb || 'brew install android-platform-tools'} />
                <p className="muted" style={{ marginTop: 10 }}>AI workspace: <code>{tools.workDir}</code></p>
              </>
            )}
          </Card>

          <Card title="Welcome tour">
            <Button onClick={() => store.updateSettings({ onboardingDone: false })}>Show the welcome screen again</Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
