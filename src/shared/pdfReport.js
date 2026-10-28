/**
 * HTML builders for the PDF exports (pit scouting + match scouting). Pure functions:
 * the main process prints the returned HTML to PDF, tests can call them directly.
 */
const { naturalNumber, pitLabels, climbLabel } = require('./models');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>');
const byTeam = (a, b) => naturalNumber(a) - naturalNumber(b);

const STYLE = `
@page { margin: 14mm 12mm; }
* { box-sizing: border-box; }
body { font: 11px/1.4 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0; }
h1 { font-size: 20px; margin: 0 0 2px; } .sub { color: #666; margin: 0 0 14px; }
h2 { font-size: 15px; margin: 0 0 6px; } h2 small { font-weight: 400; color: #777; font-size: 11px; }
.pit { display: flex; gap: 14px; border: 1px solid #bbb; border-radius: 6px; margin-bottom: 14px; break-inside: avoid; overflow: hidden; }
.pit .head { background: #e8eef7; padding: 6px 10px; font-size: 15px; font-weight: 700; }
.pit .photo { width: 230px; min-height: 160px; background: #f2f2f2; display: flex; align-items: center; justify-content: center; color: #888; font-style: italic; flex: none; }
.pit .photo img { width: 100%; display: block; }
.pit .body { padding: 8px 10px 8px 0; flex: 1; }
.pit dl { display: grid; grid-template-columns: 90px 1fr; margin: 0 0 6px; } .pit dt { font-weight: 700; } .pit dd { margin: 0; }
.pit dt, .pit dd { padding: 2px 0; border-bottom: 1px solid #e5e5e5; }
.team { break-inside: avoid; margin-bottom: 16px; }
table { width: 100%; border-collapse: collapse; font-size: 10px; }
th { background: #1f3a68; color: #fff; padding: 3px 4px; text-align: center; }
td { padding: 3px 4px; border: 1px solid #ddd; text-align: center; vertical-align: top; }
td.l { text-align: left; } tr.avg td { background: #e8eef7; font-weight: 700; }
`;

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;

/** photos: optional { [teamNumber]: dataUrl } for pits that only have a local image path. */
function pitReportHtml(comp, photos = {}) {
  const latest = new Map();
  for (const p of comp.pits || []) {
    const prev = latest.get(p.teamNumber);
    if (!prev || String(p.importedAt) > String(prev.importedAt)) latest.set(p.teamNumber, p);
  }
  const cards = [...latest.keys()].sort(byTeam).map((t) => {
    const p = latest.get(t);
    const L = pitLabels(p);
    const img = p.imageData || photos[t];
    return `<div><div class="pit"><div class="photo">${img ? `<img src="${esc(img)}">` : 'No photo'}</div><div class="body">
<div class="head" style="margin:0 0 6px -14px;padding-left:14px">Team ${esc(t)}</div>
<dl><dt>Drivetrain</dt><dd>${esc(L.driveTrain)}</dd><dt>Intake</dt><dd>${esc(L.intake)}</dd><dt>Launcher</dt><dd>${esc(L.launcher)}</dd><dt>Traversal</dt><dd>${esc(L.terrain)}</dd><dt>Width</dt><dd>${p.width ? `${esc(p.width)} in` : '–'}</dd></dl>
<div><b>Notes:</b> ${esc(p.notes) || '–'}</div></div></div></div>`;
  });
  return page(`${comp.name} Pit Scouting`, `<h1>${esc(comp.name)} — Pit Scouting</h1><p class="sub">${cards.length} teams, in number order</p>${cards.join('')}`);
}

const avg = (list, k) => (list.reduce((s, m) => s + (Number(m[k]) || 0), 0) / list.length).toFixed(1);

function matchReportHtml(comp) {
  const byT = new Map();
  for (const m of comp.matches || []) {
    if (!byT.has(m.teamNumber)) byT.set(m.teamNumber, []);
    byT.get(m.teamNumber).push(m);
  }
  const head = ['Match', 'Auto Hub', 'Auto Climb', 'TeleOp Hub', 'Passed', 'TeleOp Climb', 'Def Eff', 'Def s', 'Broke s', 'Under Def s', 'Scouter', 'Notes'];
  const blocks = [...byT.keys()].sort(byTeam).map((t) => {
    const list = byT.get(t).slice().sort((a, b) => naturalNumber(a.matchNumber) - naturalNumber(b.matchNumber));
    const rows = list.map((m) => `<tr><td>${esc(m.matchNumber)}</td><td>${m.autoHub}/${m.autoHubMissed}</td><td>${climbLabel(m.autoClimb)}</td><td>${m.teleOpHub}/${m.teleOpHubMissed}</td><td>${m.teleOpPassed}</td><td>${climbLabel(m.teleOpClimb)}</td><td>${m.defEffectiveness}</td><td>${m.defDuration}</td><td>${m.brokeDuration}</td><td>${m.underDefDuration}</td><td class="l">${esc(m.scouterName)}</td><td class="l">${esc(m.notes)}</td></tr>`).join('');
    const a = `<tr class="avg"><td>Avg</td><td>${avg(list, 'autoHub')}/${avg(list, 'autoHubMissed')}</td><td></td><td>${avg(list, 'teleOpHub')}/${avg(list, 'teleOpHubMissed')}</td><td>${avg(list, 'teleOpPassed')}</td><td></td><td>${avg(list, 'defEffectiveness')}</td><td>${avg(list, 'defDuration')}</td><td>${avg(list, 'brokeDuration')}</td><td>${avg(list, 'underDefDuration')}</td><td></td><td></td></tr>`;
    return `<div class="team"><h2>Team ${esc(t)} <small>(${list.length} match${list.length === 1 ? '' : 'es'})</small></h2><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}${a}</tbody></table></div>`;
  });
  return page(`${comp.name} Match Scouting`, `<h1>${esc(comp.name)} — Robot Match Scouting</h1><p class="sub">${blocks.length} teams, ${(comp.matches || []).length} match records, in number order. Hub = made/missed. Def = effectiveness (0-5) / seconds; Broke = seconds broken down; Under Def = seconds being defended.</p>${blocks.join('')}`);
}

module.exports = { pitReportHtml, matchReportHtml };
