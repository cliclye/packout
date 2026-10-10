import { api } from '../api';
import { store } from '../store';

/** Scans folders/files in the main process and merges what it finds into the current competition. */
export async function importPaths(paths, label) {
  let total = 0;
  for (const p of paths) {
    const res = await api.sync.importPath(p);
    total += store.importResults(res, label || p.split(/[/\\]/).pop());
  }
  return total;
}
