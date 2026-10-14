import { api } from '../api';

/** Live queue status for an event, or throws with a readable message. */
export async function loadNexus(eventKey) {
  // Dev-only hook so the page can be exercised without a real key/event.
  const res = window.__nexusMock ? await window.__nexusMock(`/event/${eventKey}`) : await api.nexus.fetch(`/event/${eventKey}`);
  if (res.error) {
    const err = new Error(res.error);
    err.status = res.status;
    throw err;
  }
  return res.data;
}
