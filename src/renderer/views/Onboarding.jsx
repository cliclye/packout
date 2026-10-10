import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { store } from '../store';
import { Button, Icon, Logo } from '../components/ui';

const FEATURES = [
  ['picklist', 'Picklists that adapt to your strategy'],
  ['chart', 'Analysis across every team and metric'],
  ['route', 'AI robot paths from match video'],
  ['phone', 'Wireless-free phone sync over USB'],
  ['film', 'Film review synced to scouting data'],
  ['wrench', 'Pit scouting with robot photos'],
];

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [tools, setTools] = useState(null);
  useEffect(() => {
    if (step === 1) api.tools.status().then(setTools).catch(() => setTools({}));
  }, [step]);

  const finish = () => store.updateSettings({ onboardingDone: true });

  const rows = tools && [
    ['Python 3.9–3.12', tools.python?.ok, 'AI path tracing', tools.python?.message],
    ['yt-dlp', Boolean(tools.ytdlp), 'Downloading match video', 'brew install yt-dlp'],
    ['adb', Boolean(tools.adb), 'Phone sync', 'brew install android-platform-tools'],
    ['ffmpeg', Boolean(tools.ffmpeg), 'Video merging (optional)', 'brew install ffmpeg'],
  ];

  return (
    <div className="onboard">
      <div className="card onboard-card">
        <div className="card-body" style={{ padding: 28 }}>
          <div className="onboard-steps">{[0, 1, 2].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
          {step === 0 && (
            <div className="stack" style={{ gap: 16 }}>
              <Logo size={48} />
              <div>
                <h1 style={{ fontSize: 28, letterSpacing: '-0.02em' }}>Welcome to Packout</h1>
                <p className="muted" style={{ fontSize: 15, marginTop: 4 }}>The FRC scouting workstation for picklists, film review and AI robot tracking.</p>
              </div>
              <ul className="feature-list">{FEATURES.map(([icon, text]) => <li key={text}><Icon name={icon} size={18} />{text}</li>)}</ul>
              <div><Button variant="primary" icon="arrowRight" onClick={() => setStep(1)}>Get started</Button></div>
            </div>
          )}
          {step === 1 && (
            <div className="stack">
              <h2 style={{ fontSize: 22 }}>Optional tools</h2>
              <p className="muted">Packout works without these, but each unlocks a feature. You can install them any time.</p>
              <div>
                {!rows ? <p className="muted">Checking your computer…</p> : rows.map(([name, ok, why, fix]) => (
                  <div className="tool-row" key={name}>
                    <div><strong>{name}</strong><small>{ok ? why : `${why} — ${fix}`}</small></div>
                    <span className={`tool-state ${ok ? 'ok' : 'bad'}`}><Icon name={ok ? 'check' : 'alert'} size={15} />{ok ? 'Found' : 'Missing'}</span>
                  </div>
                ))}
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <Button variant="ghost" icon="arrowLeft" onClick={() => setStep(0)}>Back</Button>
                <Button variant="primary" icon="arrowRight" onClick={() => setStep(2)}>Continue</Button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="stack">
              <h2 style={{ fontSize: 22 }}>You’re all set</h2>
              <p className="muted">Next, create a competition for your event. You can add API keys for The Blue Alliance and Roboflow later in Settings.</p>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <Button variant="ghost" icon="arrowLeft" onClick={() => setStep(1)}>Back</Button>
                <Button variant="primary" onClick={finish}>Open Packout</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
