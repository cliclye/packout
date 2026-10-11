import { api } from '../api';
import { store, getCurrent } from '../store';
import { eventMemo } from './tbaLive';

/**
 * Packs the current competition into one text file (.packout, plain JSON) that another
 * Packout can import. Pit photos are embedded as small JPEGs and the latest TBA data
 * is attached so the recipient sees the same Event Live / predictions without a key.
 */
export async function buildShareText() {
  const comp = getCurrent();
  if (!comp) throw new Error('No competition selected.');
  const base = JSON.parse(store.exportCompetitionJson());
  const c = base.competition;
  for (const pit of c.pits) {
    if (!pit.imageData && pit.imagePath) {
      try {
        pit.imageData = await api.files.thumbnail(pit.imagePath, 640);
      } catch {
        /* photo missing on disk — skip */
      }
    }
    pit.imagePath = null; // local paths mean nothing on another computer
    pit.sourcePath = '';
  }
  c.videos = []; // video files live on this computer only
  c.matches.forEach((m) => { m.sourcePath = ''; });
  const key = (comp.eventKey || '').trim();
  if (eventMemo.data && eventMemo.key === key) c.tbaSnapshot = eventMemo.data;
  return JSON.stringify({ ...base, kind: 'packout-share', exportedAt: new Date().toISOString(), from: 'Packout' });
}

/** Cheap look inside a share file for the confirmation dialog. */
export function inspectShare(text) {
  const d = JSON.parse(text);
  const c = d.competition && (d.data ? { ...d.competition, ...d.data } : d.competition);
  if (!c) throw new Error('This file is not a Packout competition share or backup.');
  return {
    name: c.name || 'Competition',
    eventKey: c.eventKey || '',
    exportedAt: d.exportedAt || c.createdAt || '',
    counts: { matches: (c.matches || []).length, pits: (c.pits || []).length, paths: (c.paths || []).length, schedule: (c.schedule || []).length },
    hasTba: Boolean(c.tbaSnapshot),
  };
}
