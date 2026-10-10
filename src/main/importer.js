const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeMatch, normalizePit, normalizePathRun, normalizeVideo } = require('../shared/models');
const { parsePathCsv, resamplePath } = require('../shared/pathData');

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm']);
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png'];
const MAX_DEPTH = 8;

function defaultFolders() {
  const docs = path.join(os.homedir(), 'Documents');
  return [
    { id: 'match', label: 'Match Data', path: path.join(docs, 'ScoutingData') },
    { id: 'pit', label: 'Pit Data', path: path.join(docs, 'PitData') },
    { id: 'video', label: 'Match Videos', path: path.join(docs, 'MatchVideos') },
    { id: 'pack', label: 'PACK Videos', path: path.join(docs, 'PACKVideos') },
    { id: 'ai', label: 'AI Paths', path: path.join(docs, 'ScoutingAIData') },
  ].map((f) => ({ ...f, exists: fs.existsSync(f.path) }));
}

function walk(dir, visit, depth = 0) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, visit, depth + 1);
    else if (e.isFile()) visit(full);
  }
}

function inferMatchNumber(file) {
  const name = path.basename(file, path.extname(file)).toLowerCase();
  for (const key of ['match', 'qual', 'qm', 'q']) {
    const i = name.indexOf(key);
    if (i >= 0) {
      const m = name.slice(i + key.length).match(/^\D{0,2}(\d+)/);
      if (m) return String(parseInt(m[1], 10));
    }
  }
  const digits = name.replace(/\D/g, '');
  return digits ? String(parseInt(digits, 10)) : null;
}

function siblingPitImage(file, team) {
  const dir = path.dirname(file);
  for (const ext of IMAGE_EXTS) {
    const p = path.join(dir, `image_team${team}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function mtimeIso(file) {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Scans a folder (or a single file) for scouting JSON (match/pit), AI path CSVs
 * and match videos. Record ids are derived from the file path so re-importing
 * the same folder updates records instead of duplicating them.
 */
function importPath(target) {
  const out = { matchRecords: [], pitRecords: [], pathRuns: [], videos: [], skipped: 0 };
  if (!target || !fs.existsSync(target)) return out;

  const handle = (file) => {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.json') {
      let data;
      try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        out.skipped++;
        return;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        out.skipped++;
        return;
      }
      if (data.matchNumber !== undefined && data.teamNumber !== undefined) {
        const rec = normalizeMatch({ ...data, id: `file:${file}`, sourcePath: file, importedAt: mtimeIso(file) });
        if (rec.teamNumber && rec.matchNumber) out.matchRecords.push(rec);
        else out.skipped++;
      } else if (data.teamNumber !== undefined) {
        const rec = normalizePit({
          ...data,
          id: `file:${file}`,
          sourcePath: file,
          importedAt: mtimeIso(file),
          imagePath: siblingPitImage(file, String(data.teamNumber).trim()),
        });
        if (rec.teamNumber) out.pitRecords.push(rec);
        else out.skipped++;
      }
    } else if (ext === '.csv') {
      const team = path.basename(file, ext).replace(/\D/g, '');
      if (!team) return;
      let runs;
      try {
        runs = parsePathCsv(fs.readFileSync(file, 'utf8'));
      } catch {
        out.skipped++;
        return;
      }
      runs.forEach((samples, i) => {
        const reduced = resamplePath(samples);
        if (reduced.length < 2) return;
        out.pathRuns.push(
          normalizePathRun({
            id: `file:${file}#${i}`,
            teamNumber: team,
            matchNumber: '',
            source: 'csv',
            sourcePath: file,
            samples: reduced,
            createdAt: mtimeIso(file),
          })
        );
      });
    } else if (VIDEO_EXTS.has(ext)) {
      out.videos.push(normalizeVideo({ id: `file:${file}`, url: file, inferredMatchNumber: inferMatchNumber(file) }));
    }
  };

  const st = fs.statSync(target);
  if (st.isDirectory()) walk(target, handle);
  else handle(target);
  return out;
}

module.exports = { importPath, defaultFolders, inferMatchNumber };
