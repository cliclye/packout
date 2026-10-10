import { api } from '../api';

/** Qualification schedule for an event key (e.g. 2026pncmp), shaped like ScheduledMatch. */
export async function fetchEventSchedule(eventKey) {
  const res = await api.tba.fetch(`/event/${encodeURIComponent(eventKey.trim())}/matches/simple`);
  if (res.error) throw new Error(res.error);
  if (!Array.isArray(res.data)) throw new Error('Unexpected response from The Blue Alliance.');
  return res.data
    .filter((m) => m.comp_level === 'qm')
    .sort((a, b) => a.match_number - b.match_number)
    .map((m) => {
      const t = m.predicted_time || m.time;
      return {
        matchNumber: m.match_number,
        name: `Quals ${m.match_number}`,
        redTeams: (m.alliances?.red?.team_keys || []).map((k) => k.replace('frc', '')),
        blueTeams: (m.alliances?.blue?.team_keys || []).map((k) => k.replace('frc', '')),
        timeLabel: t ? new Date(t * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '',
      };
    });
}

export async function fetchEvents(year) {
  const res = await api.tba.fetch(`/events/${year}/simple`);
  if (res.error) throw new Error(res.error);
  if (!Array.isArray(res.data)) throw new Error('Unexpected response from The Blue Alliance.');
  return [...res.data].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
}
