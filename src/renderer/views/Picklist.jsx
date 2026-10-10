import React, { useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { getSummaries, store, useApp, useCurrent } from '../store';
import { Badge, Button, Card, Empty, Field, Icon, PageHeader, RankBadge, RiskTag, RoleTag, SearchInput, Segmented, Spinner, fmt, pct } from '../components/ui';
import TeamDetail from '../components/TeamDetail';
import { STRATEGIES, blendedScore, strategyScore } from '../../shared/analytics';

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** Tiny markdown subset for model replies: **bold**, lists, paragraphs. */
function Markdown({ text }) {
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
  const blocks = [];
  let list = null;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const li = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      if (!list) { list = []; blocks.push({ type: 'ul', items: list }); }
      list.push(li[1]);
    } else {
      list = null;
      if (line.trim()) blocks.push({ type: 'p', text: line.replace(/^#+\s*/, '') });
    }
  }
  return blocks.map((b, i) =>
    b.type === 'ul' ? <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul> : <p key={i}>{inline(b.text)}</p>
  );
}

const QUICK = ['Recommend my best 3 picks right now', 'Who is the best defensive option still available?', 'Find an undervalued sleeper pick'];

function Assistant({ available, alliance, strategy1, strategy2 }) {
  const { settings } = useApp();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);
  const provider = settings.llmProvider === 'anthropic' ? 'Anthropic' : 'OpenAI';
  const model = settings.llmProvider === 'anthropic' ? settings.anthropicModel : settings.openaiModel;

  const context = () =>
    JSON.stringify({
      strategy: { pick1: strategy1, pick2: strategy2 },
      ourAlliance: alliance,
      availableTeams: available.slice(0, 30).map((t) => ({
        team: t.teamNumber, rank: t.rank, role: t.role, matches: t.matchCount, avgPoints: +t.averageScore.toFixed(1),
        efficiency: +t.shootingEfficiency.toFixed(2), reliability: +t.reliability.toFixed(0), defense: +t.defenseIndex.toFixed(0),
        climbRate: +t.climbRate.toFixed(2), avgDownSeconds: +t.averageBrokeSeconds.toFixed(0), risk: t.riskLabel, flags: t.flags,
      })),
    });

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const payload = next.map((m, i) => (i === next.length - 1 && m.role === 'user' ? { ...m, content: `${m.content}\n\nCurrent scouting data (JSON):\n${context()}` } : m));
      const res = await api.llm.chat({
        system: 'You are an FRC alliance-selection analyst helping a scouting team build a picklist. Use only the supplied scouting data, cite team numbers, be concise, and explain trade-offs in a few bullet points.',
        messages: payload,
      });
      setMessages([...next, res.error ? { role: 'assistant', content: `⚠️ ${res.error}`, error: true } : { role: 'assistant', content: res.text }]);
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: `⚠️ ${e.message}`, error: true }]);
    } finally {
      setBusy(false);
      setTimeout(() => logRef.current && (logRef.current.scrollTop = logRef.current.scrollHeight), 30);
    }
  };

  if (!settings.llmApiKey) {
    return (
      <Card title="Picklist assistant">
        <Empty icon="sparkles" title="Connect a model" body="Add an OpenAI or Anthropic API key in Settings to get pick recommendations grounded in your scouting data." action={<Button variant="primary" onClick={() => store.go('settings')}>Open Settings</Button>} />
      </Card>
    );
  }
  return (
    <Card title="Picklist assistant" subtitle={`${provider} · ${model}`} actions={messages.length > 0 && <Button size="sm" variant="ghost" onClick={() => setMessages([])}>Clear</Button>}>
      <div className="chat">
        <div className="chat-log" ref={logRef}>
          {messages.length === 0 && (
            <div className="pill-row">{QUICK.map((q) => <button key={q} type="button" className="chip" onClick={() => send(q)}>{q}</button>)}</div>
          )}
          {messages.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}</div>)}
          {busy && <div className="msg assistant"><Spinner size={14} /></div>}
        </div>
        <div className="row">
          <input className="input" value={input} placeholder="Ask about picks, synergy, defense…" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
          <Button variant="primary" icon="send" onClick={() => send()} disabled={!input.trim() || busy} />
        </div>
      </div>
    </Card>
  );
}

export default function Picklist() {
  const comp = useCurrent();
  const { selectedTeam } = useApp();
  const summaries = getSummaries(comp);
  const pl = comp.picklist;
  const [search, setSearch] = useState('');
  const [hideTaken, setHideTaken] = useState(false);
  const [tab, setTab] = useState('team');

  const allianceTeams = Object.values(pl.alliance).filter(Boolean);
  const taken = useMemo(() => new Set([...pl.picked, ...allianceTeams]), [pl.picked, allianceTeams.join()]);
  const dnp = useMemo(() => new Set(pl.dnp), [pl.dnp]);

  const ranked = useMemo(
    () => summaries
      .map((s) => ({ ...s, fit: blendedScore(s, pl.strategy1, pl.strategy2) }))
      .sort((a, b) => b.fit - a.fit || a.rank - b.rank),
    [summaries, pl.strategy1, pl.strategy2]
  );
  const available = ranked.filter((s) => !taken.has(s.teamNumber) && !dnp.has(s.teamNumber));
  const rows = ranked.filter((s) => {
    if (hideTaken && taken.has(s.teamNumber)) return false;
    const q = search.trim().toLowerCase();
    return !q || s.teamNumber.includes(q) || s.role.toLowerCase().includes(q);
  });
  const pick1 = [...available].sort((a, b) => strategyScore(b, pl.strategy1) - strategyScore(a, pl.strategy1))[0];
  const pick2 = [...available].filter((s) => s !== pick1).sort((a, b) => strategyScore(b, pl.strategy2) - strategyScore(a, pl.strategy2))[0];
  const selected = selectedTeam && summaries.some((s) => s.teamNumber === selectedTeam) ? selectedTeam : ranked[0]?.teamNumber;

  const toggle = (key, team) => {
    const set = new Set(pl[key]);
    set.has(team) ? set.delete(team) : set.add(team);
    store.setPicklist({ [key]: [...set] });
  };
  const setAlliance = (slot, team) => store.setPicklist({ alliance: { ...pl.alliance, [slot]: team || null } });

  const exportCsv = async () => {
    const head = ['Order', 'Team', 'Role', 'Fit', 'PickScore', 'AvgPoints', 'Efficiency%', 'Reliability', 'Defense', 'Risk', 'Matches', 'Taken', 'DNP', 'Flags'];
    const lines = ranked.map((s, i) => [i + 1, s.teamNumber, s.role, fmt(s.fit), fmt(s.pickScore), fmt(s.averageScore), fmt(s.shootingEfficiency * 100, 0), fmt(s.reliability, 0), fmt(s.defenseIndex, 0), s.riskLabel, s.matchCount, taken.has(s.teamNumber) ? 'yes' : '', dnp.has(s.teamNumber) ? 'yes' : '', s.flags.join('|')]);
    const content = [head, ...lines].map((r) => r.map(csvCell).join(',')).join('\n');
    try {
      const file = await api.dialog.save({ content, defaultPath: `${comp.name.replace(/\W+/g, '_')}_picklist.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (file) store.toast('Picklist exported', 'success');
    } catch (e) {
      store.toast(e.message, 'error');
    }
  };

  const options = (exclude) => ranked.filter((s) => !exclude.includes(s.teamNumber) && (!pl.picked.includes(s.teamNumber)));

  if (summaries.length === 0) {
    return (
      <div className="page"><div className="page-inner">
        <PageHeader title="Picklist" subtitle="Rank teams for alliance selection" />
        <Card><Empty icon="picklist" title="Nothing to rank yet" body="Import scouting data or load the demo dataset to build a picklist." action={<Button variant="primary" onClick={() => store.loadSampleData()}>Load demo data</Button>} /></Card>
      </div></div>
    );
  }

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          title="Picklist"
          subtitle="Blend two strategies, mark teams as taken, and track your alliance"
          actions={<><Button icon="sparkles" variant={tab === 'assistant' ? 'primary' : 'secondary'} onClick={() => setTab(tab === 'assistant' ? 'team' : 'assistant')}>Assistant</Button><Button icon="download" onClick={exportCsv}>Export CSV</Button></>}
        />
        <div className="split picklist">
          <div className="col">
            <Card>
              <div className="grid-2" style={{ gap: 12 }}>
                <Field label="Pick 1 strategy" hint={STRATEGIES.find((s) => s.id === pl.strategy1)?.hint}>
                  <select className="select" style={{ width: '100%' }} value={pl.strategy1} onChange={(e) => store.setPicklist({ strategy1: e.target.value })}>
                    {STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                </Field>
                <Field label="Pick 2 strategy" hint={STRATEGIES.find((s) => s.id === pl.strategy2)?.hint}>
                  <select className="select" style={{ width: '100%' }} value={pl.strategy2} onChange={(e) => store.setPicklist({ strategy2: e.target.value })}>
                    {STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                </Field>
              </div>
              <div className="stat-grid three" style={{ margin: '14px 0 0' }}>
                <Stat2 label="Best Pick 1" value={pick1 ? `Team ${pick1.teamNumber}` : '–'} onClick={() => pick1 && store.setSelectedTeam(pick1.teamNumber)} />
                <Stat2 label="Best Pick 2" value={pick2 ? `Team ${pick2.teamNumber}` : '–'} onClick={() => pick2 && store.setSelectedTeam(pick2.teamNumber)} />
                <Stat2 label="Still available" value={`${available.length} / ${summaries.length}`} />
              </div>
            </Card>

            <Card title="Your alliance" actions={allianceTeams.length > 0 && <Button size="sm" variant="ghost" onClick={() => store.setPicklist({ alliance: { captain: null, pick1: null, pick2: null } })}>Reset</Button>}>
              <div className="grid-3" style={{ gap: 12 }}>
                {[['captain', 'Captain'], ['pick1', 'Pick 1'], ['pick2', 'Pick 2']].map(([slot, label]) => (
                  <Field key={slot} label={label}>
                    <select className="select" style={{ width: '100%' }} value={pl.alliance[slot] || ''} onChange={(e) => setAlliance(slot, e.target.value)}>
                      <option value="">— choose —</option>
                      {options(allianceTeams.filter((t) => t !== pl.alliance[slot])).map((s) => <option key={s.teamNumber} value={s.teamNumber}>Team {s.teamNumber}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
            </Card>

            <div className="row">
              <SearchInput className="grow" value={search} onChange={setSearch} placeholder="Search team number or role…" />
              <label className="check"><input type="checkbox" checked={hideTaken} onChange={(e) => setHideTaken(e.target.checked)} /> Hide taken</label>
            </div>
            <div className="list">
              {rows.map((s) => {
                const isTaken = taken.has(s.teamNumber);
                const isDnp = dnp.has(s.teamNumber);
                const hint = s === pick1 ? 'Pick 1 fit' : s === pick2 ? 'Pick 2 fit' : null;
                const order = ranked.indexOf(s) + 1;
                return (
                  <div key={s.teamNumber} className={`team-row ${selected === s.teamNumber ? 'selected' : ''} ${isTaken || isDnp ? 'dim' : ''}`} role="button" tabIndex={0}
                    onClick={() => { store.setSelectedTeam(s.teamNumber); setTab('team'); }}
                    onKeyDown={(e) => e.key === 'Enter' && store.setSelectedTeam(s.teamNumber)}>
                    <RankBadge rank={order} />
                    <div className="main-col">
                      <div className="name">
                        Team {s.teamNumber}
                        <RoleTag role={s.role} />
                        {hint && <Badge tone="teal">{hint}</Badge>}
                        {isTaken && <Badge>Taken</Badge>}
                        {isDnp && <Badge tone="danger">Do not pick</Badge>}
                      </div>
                      <div className="sub"><span>{s.matchCount} matches</span><RiskTag risk={s.riskLabel} />{s.flags.slice(0, 2).map((f) => <span key={f}>{f}</span>)}</div>
                    </div>
                    <div className="metrics">
                      <div className="metric"><span>Fit</span><strong>{fmt(s.fit)}</strong></div>
                      <div className="metric"><span>Avg</span><strong>{fmt(s.averageScore)}</strong></div>
                      <div className="metric"><span>Eff</span><strong>{pct(s.shootingEfficiency)}</strong></div>
                      <div className="metric"><span>Rel</span><strong>{fmt(s.reliability, 0)}</strong></div>
                    </div>
                    <div className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="icon-btn" title={isTaken && pl.picked.includes(s.teamNumber) ? 'Mark as available' : 'Mark as taken by another alliance'} onClick={() => toggle('picked', s.teamNumber)} style={pl.picked.includes(s.teamNumber) ? { color: 'var(--ok)' } : null}><Icon name="check" size={16} /></button>
                      <button type="button" className="icon-btn" title="Do not pick" onClick={() => toggle('dnp', s.teamNumber)} style={isDnp ? { color: 'var(--danger)' } : null}><Icon name="flag" size={16} /></button>
                    </div>
                  </div>
                );
              })}
              {rows.length === 0 && <p className="muted pad">No teams match.</p>}
            </div>
          </div>

          <div className="sticky col">
            {tab === 'assistant' ? (
              <Assistant available={available} alliance={pl.alliance} strategy1={pl.strategy1} strategy2={pl.strategy2} />
            ) : (
              <TeamDetail teamNumber={selected} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat2({ label, value, onClick }) {
  return (
    <div className="stat" style={{ padding: '10px 12px', cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 18 }}>{value}</div>
    </div>
  );
}
