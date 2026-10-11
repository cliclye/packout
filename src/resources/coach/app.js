/* Packout Coach — phone web app. Reads the "coach pack" JSON published by Packout. */
(function () {
  'use strict';
  var KEY = 'packout-coach-pack';
  var TOKEN_KEY = 'packout-coach-key';
  var $app = document.getElementById('app');
  var state = { pack: null, tab: 'next', matchKey: null, filter: 'upcoming', search: '', team: null, status: '', busy: false };

  // ---- helpers -----------------------------------------------------------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(v) { return v == null ? '–' : Math.round(v * 100) + '%'; }
  function f1(v) { return v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1); }
  function clock(ms) { return ms ? new Date(ms).toLocaleTimeString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '–'; }
  function rel(ms) {
    if (!ms) return '';
    var d = Math.round((ms - Date.now()) / 60000), a = Math.abs(d);
    if (a < 1) return 'now';
    var t = a >= 60 ? Math.floor(a / 60) + 'h ' + (a % 60) + 'm' : a + ' min';
    return d > 0 ? 'in ' + t : t + ' ago';
  }
  function toast(msg) {
    var el = document.createElement('div'); el.className = 'toast'; el.textContent = msg; document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }
  function chips(list, color, me) {
    return list.map(function (t) { return '<span class="chip ' + (t === me ? 'me' : color) + '" data-team="' + esc(t) + '">' + esc(t) + '</span>'; }).join('');
  }
  function winbar(pRed, projR, projB) {
    var r = Math.round(pRed * 100);
    return '<div class="winbar"><div class="r" style="width:' + Math.max(15, Math.min(85, r)) + '%">' + r + '%</div><div class="b">' + (100 - r) + '%</div></div>' +
      (projR != null ? '<div class="sub"><span>Red ' + projR + '</span><span>Blue ' + projB + '</span></div>' : '');
  }

  // ---- data --------------------------------------------------------------------
  function load() { try { state.pack = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { state.pack = null; } }
  function save(pack) { state.pack = pack; try { localStorage.setItem(KEY, JSON.stringify(pack)); } catch (e) { /* storage full */ } }
  function validate(p) { if (!p || p.format !== 'packout-coach') throw new Error('That is not a Packout coach file'); return p; }

  var qs = new URLSearchParams(location.search);
  if (qs.get('k')) { try { localStorage.setItem(TOKEN_KEY, qs.get('k')); } catch (e) {} history.replaceState(null, '', location.pathname); }

  function sync(silent) {
    var key = localStorage.getItem(TOKEN_KEY);
    if (!key) { if (!silent) toast('Open the link from Packout (QR code) first'); return Promise.resolve(); }
    state.busy = true; render();
    return fetch('data.json?k=' + encodeURIComponent(key), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status === 403 ? 'Wrong key — rescan the QR code' : 'Packout has nothing published yet'); return r.json(); })
      .then(function (p) { save(validate(p)); if (!silent) toast('Updated'); })
      .catch(function (e) { if (!silent) toast(e.message === 'Failed to fetch' ? 'Can’t reach Packout — showing saved data' : e.message); })
      .then(function () { state.busy = false; render(); });
  }

  // ---- views -------------------------------------------------------------------
  function header() {
    var p = state.pack;
    var title = p ? esc(p.event ? p.event.name : p.competition.name) : 'Packout Coach';
    var sub = p ? 'Updated ' + new Date(p.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (p.myTeam ? ' · Team ' + esc(p.myTeam) : '') : 'No data yet';
    return '<header><div class="grow"><h1>' + title + '</h1><small>' + sub + '</small></div><button data-act="sync">' + (state.busy ? '…' : '↻ Sync') + '</button></header>';
  }
  function nav() {
    var tabs = [['next', '🎯', 'Plan'], ['matches', '📅', 'Matches'], ['teams', '🤖', 'Teams'], ['ranks', '🏆', 'Ranks']];
    return '<nav>' + tabs.map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (state.tab === t[0] ? 'on' : '') + '"><span>' + t[1] + '</span>' + t[2] + '</button>'; }).join('') + '</nav>';
  }

  function empty() {
    var hasKey = !!localStorage.getItem(TOKEN_KEY);
    return '<main><div class="card empty"><h2>No match data yet</h2><p>' + (hasKey ? 'Tap Sync while connected to Packout.' : 'In Packout open <b>Phone</b> and scan the QR code, or plug in your Android phone and press the USB button.') + '</p>' +
      '<p><button class="primary" data-act="sync">Sync now</button> <button data-act="import">Import file</button></p></div></main>';
  }

  function teamBrief(t, color, me) {
    var d = (state.pack.teams || {})[t.team || t] || {};
    var num = t.team || t;
    var stats = d.scouted
      ? '<div class="stats"><div><span>Avg pts</span><strong>' + f1(d.avgPoints) + '</strong></div><div><span>Auto</span><strong>' + f1(d.auto) + '</strong></div><div><span>Accuracy</span><strong>' + pct(d.accuracy) + '</strong></div><div><span>Climb</span><strong>' + pct(d.climbRate) + '</strong></div><div><span>Uptime</span><strong>' + pct(d.uptime) + '</strong></div><div><span>Defense</span><strong>' + f1(d.defense) + '/5</strong></div></div>'
      : '<div class="stats"><div><span>Rating</span><strong>' + f1(d.rating) + '</strong></div><div><span>TBA rank</span><strong>' + (d.tbaRank || '–') + '</strong></div><div><span>OPR</span><strong>' + f1(d.opr) + '</strong></div></div>';
    var notes = (d.strengths && d.strengths[0] ? '<p class="ok">✓ ' + esc(d.strengths[0]) + '</p>' : '') + (d.risks && d.risks[0] ? '<p class="bad">⚠ ' + esc(d.risks[0]) + '</p>' : '');
    return '<div class="rec" style="border-left-color:var(--' + color + ')"><div class="row"><span><span class="chip ' + (num === me ? 'me' : color) + '">' + esc(num) + '</span> ' + esc(d.name || '') + '</span><span class="badge ' + (d.scouted ? '' : 'warn') + '">' + esc(t.role || (d.scouted ? d.matches + ' scouted' : 'no scouting')) + '</span></div>' + stats + notes + '</div>';
  }

  function viewNext() {
    var p = state.pack, plans = p.plans || {};
    var keys = p.matches.filter(function (m) { return plans[m.key]; });
    if (!keys.length) return '<main><div class="card empty"><h2>No game plan</h2><p>' + (p.myTeam ? 'Team ' + esc(p.myTeam) + ' has no upcoming matches in the schedule.' : 'Pick your team in Packout (Phone page) and sync again.') + '</p></div></main>';
    var cur = keys.filter(function (m) { return m.key === state.matchKey; })[0] || keys.filter(function (m) { return !m.played; })[0] || keys[keys.length - 1];
    var plan = plans[cur.key], me = p.myTeam;
    var opts = keys.map(function (m) { return '<option value="' + esc(m.key) + '"' + (m.key === cur.key ? ' selected' : '') + '>' + esc(m.label) + (m.played ? ' (played)' : ' · ' + clock(m.time)) + '</option>'; }).join('');
    var phases = ['Overall', 'Scouting', 'Defense', 'Auto', 'Teleop', 'Endgame', 'Risk'];
    var recs = phases.map(function (ph) {
      var list = plan.recs.filter(function (r) { return r.phase === ph; });
      if (!list.length) return '';
      return '<div class="card"><h3>' + ph + '</h3>' + list.map(function (r) { return '<div class="rec ' + r.priority + '"><div class="row"><b>' + esc(r.title) + '</b><span class="badge ' + r.priority + '">' + (r.priority === 'high' ? 'High' : r.priority === 'med' ? 'Med' : 'FYI') + '</span></div><p>' + esc(r.detail) + '</p></div>'; }).join('') + '</div>';
    }).join('');
    var ourColor = plan.ourColor, oppColor = ourColor === 'red' ? 'blue' : 'red';
    var pRed = ourColor === 'red' ? plan.pOurs : 1 - plan.pOurs;
    return '<main><select data-act="pick">' + opts + '</select>' +
      '<div class="card"><div class="row"><div><div class="big">' + Math.round(plan.pOurs * 100) + '%</div><div class="muted">our win chance</div></div><div style="text-align:right"><b>' + esc(cur.label) + '</b><div class="muted">' + (cur.played ? 'Final ' + cur.redScore + '–' + cur.blueScore : clock(cur.time) + ' · ' + rel(cur.time)) + '</div></div></div>' +
      '<div style="margin-top:12px">' + winbar(pRed, cur.projRed, cur.projBlue) + '</div>' +
      '<div style="margin-top:10px">' + chips(cur.red, 'red', me) + '<span class="muted"> vs </span>' + chips(cur.blue, 'blue', me) + '</div></div>' +
      recs +
      '<div class="card"><h3>Opponents</h3>' + plan.opponents.slice().sort(function (a, b) { return b.threat - a.threat; }).map(function (o) { return teamBrief(o, oppColor, me); }).join('') + '</div>' +
      '<div class="card"><h3>Our alliance</h3>' + plan.partners.map(function (o) { return teamBrief(o, ourColor, me); }).join('') + '</div>' +
      (plan.note ? '<div class="card"><h3>Match notes</h3><p>' + esc(plan.note) + '</p></div>' : '') + '</main>';
  }

  function viewMatches() {
    var p = state.pack, me = p.myTeam;
    var list = p.matches.filter(function (m) {
      if (state.filter === 'upcoming' && m.played) return false;
      if (state.filter === 'results' && !m.played) return false;
      if (state.filter === 'mine' && m.red.concat(m.blue).indexOf(me) < 0) return false;
      if (state.search && m.red.concat(m.blue).join(' ').indexOf(state.search) < 0) return false;
      return true;
    });
    if (state.filter === 'results') list = list.slice().reverse();
    var seg = ['upcoming', 'results', 'mine', 'all'].map(function (f) { return '<button data-filter="' + f + '" class="' + (state.filter === f ? 'on' : '') + '">' + { upcoming: 'Next', results: 'Results', mine: 'Mine', all: 'All' }[f] + '</button>'; }).join('');
    var rows = list.slice(0, 120).map(function (m) {
      var mine = m.red.concat(m.blue).indexOf(me) >= 0;
      var rw = m.winner === 'red', bw = m.winner === 'blue';
      return '<div class="mrow ' + (mine ? 'mine' : '') + '"><div class="row"><b>' + esc(m.label) + '</b><span class="muted">' + (m.played ? '' : clock(m.time) + ' · ' + rel(m.time)) + '</span></div>' +
        '<div class="row" style="margin-top:6px"><div>' + chips(m.red, 'red', me) + '</div><span class="score ' + (rw ? 'win' : 'lose') + '">' + (m.played ? m.redScore : '') + '</span></div>' +
        '<div class="row"><div>' + chips(m.blue, 'blue', me) + '</div><span class="score ' + (bw ? 'win' : 'lose') + '">' + (m.played ? m.blueScore : '') + '</span></div>' +
        (m.played ? '' : '<div style="margin-top:8px">' + winbar(m.pRed, m.projRed, m.projBlue) + '</div>') + '</div>';
    }).join('') || '<div class="empty">Nothing here.</div>';
    return '<main><div class="seg">' + seg + '</div><input type="search" placeholder="Filter by team #" value="' + esc(state.search) + '" data-act="search"><div class="card" style="padding:0">' + rows + '</div></main>';
  }

  function viewTeams() {
    var p = state.pack, teams = Object.keys(p.teams || {}).sort(function (a, b) { return a - b; });
    if (state.team && p.teams[state.team]) {
      var d = p.teams[state.team];
      return '<main><button data-act="back">‹ All teams</button><div class="card"><div class="row"><div><div class="big">' + esc(d.number) + '</div><div class="muted">' + esc(d.name || '') + '</div></div><span class="badge ' + (d.scouted ? 'ok' : 'warn') + '">' + (d.scouted ? d.matches + ' scouted' : 'no scouting') + '</span></div>' +
        '<div class="stats"><div><span>Avg pts</span><strong>' + f1(d.avgPoints) + '</strong></div><div><span>Auto</span><strong>' + f1(d.auto) + '</strong></div><div><span>Endgame</span><strong>' + f1(d.endgame) + '</strong></div><div><span>Accuracy</span><strong>' + pct(d.accuracy) + '</strong></div><div><span>Climb</span><strong>' + pct(d.climbRate) + '</strong></div><div><span>Uptime</span><strong>' + pct(d.uptime) + '</strong></div><div><span>Defense</span><strong>' + f1(d.defense) + '</strong></div><div><span>TBA rank</span><strong>' + (d.tbaRank || '–') + '</strong></div><div><span>OPR</span><strong>' + f1(d.opr) + '</strong></div></div></div>' +
        (d.strengths.length ? '<div class="card"><h3>Strengths</h3>' + d.strengths.map(function (s) { return '<p class="ok">✓ ' + esc(s) + '</p>'; }).join('') + '</div>' : '') +
        (d.risks.length ? '<div class="card"><h3>Watch-outs</h3>' + d.risks.map(function (s) { return '<p class="bad">⚠ ' + esc(s) + '</p>'; }).join('') + '</div>' : '') + '</main>';
    }
    var q = state.search;
    var rows = teams.filter(function (t) { return !q || t.indexOf(q) >= 0; }).map(function (t) {
      var d = p.teams[t];
      return '<div class="mrow" data-team="' + t + '"><div class="row"><b>' + t + ' <span class="muted">' + esc(d.name || '') + '</span></b><span class="muted">' + (d.scouted ? f1(d.avgPoints) + ' pts' : 'OPR ' + f1(d.opr)) + '</span></div></div>';
    }).join('');
    return '<main><input type="search" placeholder="Search team #" value="' + esc(q) + '" data-act="search"><div class="card" style="padding:0">' + rows + '</div></main>';
  }

  function viewRanks() {
    var p = state.pack, me = p.myTeam;
    if (!p.rankings.length) return '<main><div class="card empty"><h2>No rankings yet</h2></div></main>';
    return '<main><div class="card" style="padding:6px 10px"><table><tr><th>#</th><th>Team</th><th>Record</th><th>Played</th></tr>' +
      p.rankings.map(function (r) { return '<tr class="' + (r.team === me ? 'mine' : '') + '" data-team="' + r.team + '"><td><b>' + r.rank + '</b></td><td>' + r.team + '</td><td>' + esc(r.record) + '</td><td>' + r.played + '</td></tr>'; }).join('') + '</table></div></main>';
  }

  function render() {
    if (!state.pack) { $app.innerHTML = header() + empty(); return; }
    var body = { next: viewNext, matches: viewMatches, teams: viewTeams, ranks: viewRanks }[state.tab]();
    var active = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-act') === 'search';
    $app.innerHTML = header() + body + nav();
    if (active) { var el = $app.querySelector('[data-act=search]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
  }

  // ---- events ------------------------------------------------------------------
  $app.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab],[data-act],[data-filter],[data-team]');
    if (!t) return;
    if (t.dataset.tab) { state.tab = t.dataset.tab; state.team = null; window.scrollTo(0, 0); render(); }
    else if (t.dataset.filter) { state.filter = t.dataset.filter; render(); }
    else if (t.dataset.act === 'sync') sync(false);
    else if (t.dataset.act === 'import') document.getElementById('file').click();
    else if (t.dataset.act === 'back') { state.team = null; render(); }
    else if (t.dataset.team && state.pack) { state.tab = 'teams'; state.team = t.dataset.team; window.scrollTo(0, 0); render(); }
  });
  $app.addEventListener('change', function (e) { if (e.target.dataset.act === 'pick') { state.matchKey = e.target.value; render(); } });
  $app.addEventListener('input', function (e) { if (e.target.dataset.act === 'search') { state.search = e.target.value.trim(); render(); } });
  document.getElementById('file').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    f.text().then(function (t) { save(validate(JSON.parse(t))); toast('Imported'); render(); }).catch(function (err) { toast(err.message); });
  });

  load();
  render();
  sync(true);
  setInterval(function () { if (state.pack) render(); }, 60000); // keeps countdowns fresh
  setInterval(function () { sync(true); }, 30000);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
