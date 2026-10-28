import { api } from '../api';
import { store } from '../store';
import { pitReportHtml, matchReportHtml } from '../../shared/pdfReport';

const safe = (s) => String(s || 'competition').replace(/[^\w-]+/g, '_');

async function run(build, kind, comp, landscape) {
  try {
    const out = await api.pdf.export({ html: await build(), defaultName: `${safe(comp.name)}_${kind}.pdf`, landscape });
    if (out) store.toast(`Saved ${kind.replace('_', ' ')} PDF`, 'success');
  } catch (e) {
    store.toast(`PDF export failed: ${e.message}`, 'error');
  }
}

export function exportPitPdf(comp) {
  return run(async () => {
    const photos = {};
    for (const p of comp.pits) {
      if (!p.imageData && p.imagePath) {
        try { photos[p.teamNumber] = await api.files.thumbnail(p.imagePath, 640); } catch { /* photo missing */ }
      }
    }
    return pitReportHtml(comp, photos);
  }, 'Pit_Scouting', comp, false);
}

export const exportMatchPdf = (comp) => run(async () => matchReportHtml(comp), 'Match_Scouting', comp, true);
