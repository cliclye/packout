/**
 * Support for records written by Scout Runtime (the phone app built with Scout
 * Studio). A record looks like:
 *   { formatVersion: 1, form: 'match'|'pit'|…, meta: {team, match, scouter, station},
 *     values: {fieldId: v}, events: {fieldId: [{t,name,x?,y?}]}, computed: {id: v},
 *     legacy?: {packoutKey: v} }
 * `legacy` is filled from fields that carry a Packout key, so the built-in
 * views keep working; everything else is analysed generically from `custom`.
 */

const isDesignRecord = (d) =>
  !!d && typeof d === 'object' && !Array.isArray(d) && d.formatVersion >= 1 && d.values && typeof d.values === 'object' && d.meta && typeof d.meta === 'object';

/** Raw object for normalizeMatch / normalizePit, with the full record kept under `custom`. */
function designToRaw(d) {
  const custom = { form: d.form || 'match', design: d.design || '', station: d.meta.station || '', values: d.values, events: d.events || {}, computed: d.computed || {} };
  return {
    ...(d.legacy || {}),
    teamNumber: d.meta.team,
    matchNumber: d.meta.match,
    scouterName: d.meta.scouter || '',
    custom,
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Columns to analyse: every numeric value, computed value and event count seen in
 * `records` (match records with `custom`). `schema` (exported from Scout Studio)
 * only supplies nicer labels.
 */
function columnsFor(records, schema) {
  const labels = {};
  const form = schema && (schema.forms || []).find((f) => f.id === 'match');
  if (form) {
    for (const f of form.fields) labels[f.id] = f.label;
    for (const c of form.computed) labels[c.id] = c.label;
  }
  const cols = new Map();
  const add = (key, kind) => { if (!cols.has(key)) cols.set(key, { key, kind, label: labels[key.replace(/^(v|c|e):/, '')] || key.replace(/^(v|c|e):/, '') }); };
  for (const r of records) {
    const c = r.custom;
    if (!c) continue;
    for (const [k, v] of Object.entries(c.values)) if (isNum(v)) add(`v:${k}`, 'value');
    for (const [k, v] of Object.entries(c.computed)) if (isNum(v)) add(`c:${k}`, 'computed');
    for (const k of Object.keys(c.events)) add(`e:${k}`, 'events');
  }
  return [...cols.values()];
}

function cellValue(rec, key) {
  const c = rec.custom;
  const id = key.slice(2);
  if (key.startsWith('v:')) return c.values[id];
  if (key.startsWith('c:')) return c.computed[id];
  if (key.startsWith('e:')) return (c.events[id] || []).length;
  return undefined;
}

/** One row per team: average of each column across that team's matches. */
function teamTable(records, schema) {
  const cols = columnsFor(records, schema);
  const byTeam = new Map();
  for (const r of records) {
    if (!r.custom) continue;
    if (!byTeam.has(r.teamNumber)) byTeam.set(r.teamNumber, []);
    byTeam.get(r.teamNumber).push(r);
  }
  const rows = [...byTeam.entries()].map(([team, recs]) => {
    const avg = {};
    for (const col of cols) {
      const vals = recs.map((r) => cellValue(r, col.key)).filter(isNum);
      avg[col.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    return { team, matches: recs.length, avg };
  });
  return { cols, rows };
}

/** All tapped points (x,y in 0..1) for one team and event field, across matches. */
function pointsFor(records, team, fieldId) {
  const out = [];
  for (const r of records) {
    if (r.teamNumber !== team || !r.custom) continue;
    for (const e of r.custom.events[fieldId] || []) if (isNum(e.x) && isNum(e.y)) out.push({ x: e.x, y: e.y, name: e.name, match: r.matchNumber });
  }
  return out;
}

module.exports = { isDesignRecord, designToRaw, columnsFor, teamTable, pointsFor, cellValue };
