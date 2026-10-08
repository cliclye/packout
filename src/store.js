import { summarize } from './analytics.js';
import { matchRecords as sampleMatches, pitRecords as samplePits, pathFiles as samplePaths } from './sampleData.js';
import { MatchRecord, PitRecord, RobotPathFile, ScheduledMatch, VideoAsset } from './models.js';

let state = {
  competitions: [],
  currentCompetitionId: null,
  matches: [],
  pits: [],
  paths: [],
  schedule: [],
  videos: [],
  importLog: [],
  selectedTeam: null
};

const listeners = new Set();

function notify() {
  for (const listener of listeners) {
    listener(state);
  }
}

function naturalCompare(a, b) {
  const numA = parseInt((a || "").toString().replace(/\D/g, '') || "0", 10);
  const numB = parseInt((b || "").toString().replace(/\D/g, '') || "0", 10);
  return numA - numB;
}

export const store = {
  getState() {
    return state;
  },

  subscribe(callback) {
    listeners.add(callback);
    callback(state);
    return () => listeners.delete(callback);
  },

  // Competition Management
  createCompetition(name, eventKey) {
    const id = Date.now().toString();
    const newCompetition = {
      id,
      name,
      eventKey,
      createdAt: new Date().toISOString(),
      matches: [],
      pits: [],
      paths: [],
      schedule: [],
      videos: [],
      importLog: []
    };
    state = { ...state, competitions: [...state.competitions, newCompetition] };
    this.switchCompetition(id);
    this.saveCompetitions();
    this.appendLog(`Created competition: ${name}`);
  },

  switchCompetition(id) {
    const competition = state.competitions.find(c => c.id === id);
    if (!competition) return;

    state = {
      ...state,
      currentCompetitionId: id,
      matches: competition.matches || [],
      pits: competition.pits || [],
      paths: competition.paths || [],
      schedule: competition.schedule || [],
      videos: competition.videos || [],
      importLog: competition.importLog || []
    };
    this.saveCompetitions();
    notify();
  },

  deleteCompetition(id) {
    const filtered = state.competitions.filter(c => c.id !== id);
    state = { ...state, competitions: filtered };

    if (state.currentCompetitionId === id) {
      if (filtered.length > 0) {
        this.switchCompetition(filtered[0].id);
      } else {
        state = { ...state, currentCompetitionId: null, matches: [], pits: [], paths: [], schedule: [], videos: [], importLog: [] };
        notify();
      }
    }
    this.saveCompetitions();
    this.appendLog(`Deleted competition`);
  },

  getCurrentCompetition() {
    return state.competitions.find(c => c.id === state.currentCompetitionId) || null;
  },

  saveCompetitions() {
    const competitionsData = state.competitions.map(c => ({
      ...c,
      matches: (c.matches || []).map(m => ({ ...m })),
      pits: (c.pits || []).map(p => ({ ...p })),
      paths: (c.paths || []).map(p => ({ ...p })),
      schedule: (c.schedule || []).map(s => ({ ...s })),
      videos: (c.videos || []).map(v => ({ ...v })),
      importLog: c.importLog || []
    }));

    localStorage.setItem('packout_competitions', JSON.stringify(competitionsData));
    localStorage.setItem('packout_current_competition', state.currentCompetitionId || '');
  },

  loadCompetitions() {
    const saved = localStorage.getItem('packout_competitions');
    const currentId = localStorage.getItem('packout_current_competition');

    if (saved) {
      try {
        const competitions = JSON.parse(saved);
        state = { ...state, competitions };

        if (currentId && competitions.find(c => c.id === currentId)) {
          this.switchCompetition(currentId);
        } else if (competitions.length > 0) {
          this.switchCompetition(competitions[0].id);
        }
      } catch (e) {
        console.error('Failed to load competitions:', e);
      }
    }
  },

  updateCurrentCompetition() {
    if (!state.currentCompetitionId) return;

    const competitions = state.competitions.map(c => {
      if (c.id === state.currentCompetitionId) {
        return {
          ...c,
          matches: state.matches,
          pits: state.pits,
          paths: state.paths,
          schedule: state.schedule,
          videos: state.videos,
          importLog: state.importLog
        };
      }
      return c;
    });

    state = { ...state, competitions };
    this.saveCompetitions();
  },
  
  importData({ matches = [], pits = [], paths = [], videos = [] }) {
    const newMatches = [...state.matches];
    matches.forEach(m => {
      const idx = newMatches.findIndex(x => x.id === m.id);
      if (idx >= 0) newMatches[idx] = new MatchRecord(m);
      else newMatches.push(new MatchRecord(m));
    });

    const newPits = [...state.pits];
    pits.forEach(p => {
      const idx = newPits.findIndex(x => x.id === p.id);
      if (idx >= 0) newPits[idx] = new PitRecord(p);
      else newPits.push(new PitRecord(p));
    });

    const newPaths = [...state.paths];
    paths.forEach(p => {
      const idx = newPaths.findIndex(x => x.id === p.id);
      if (idx >= 0) newPaths[idx] = new RobotPathFile(p);
      else newPaths.push(new RobotPathFile(p));
    });

    const newVideos = [...state.videos];
    videos.forEach(v => {
      const idx = newVideos.findIndex(x => x.id === v.id);
      if (idx >= 0) newVideos[idx] = new VideoAsset(v);
      else newVideos.push(new VideoAsset(v));
    });

    state = { ...state, matches: newMatches, pits: newPits, paths: newPaths, videos: newVideos };
    this.appendLog(`Imported ${matches.length} matches, ${pits.length} pits, ${paths.length} paths, ${videos.length} videos.`);
    this.updateCurrentCompetition();
    notify();
  },

  importFolderResults(results) {
    if (!results) return;
    const matches = (results.matchRecords || []).map(m => new MatchRecord(m));
    const pits = (results.pitRecords || []).map(p => new PitRecord(p));
    const paths = (results.robotPaths || []).map(rp => new RobotPathFile({
      teamNumber: (rp.team || '').toString(),
      sourcePath: rp.file || '',
      samples: (rp.pathPoints || []).map(pt => new RobotPathSample(pt))
    }));
    const videos = (results.videoFiles || []).map(vf => {
      let inferred = null;
      const base = vf.split(/[/\\]/).pop().toLowerCase();
      const match = base.match(/(?:match|qual|qm|q)(\d+)/) || base.match(/\d+/);
      if (match) inferred = match[1] || match[0];
      return new VideoAsset({ url: vf, inferredMatchNumber: inferred });
    });
    this.importData({ matches, pits, paths, videos });
  },
  
  replaceSchedule(schedule, source) {
    state = { ...state, schedule: schedule.map(s => new ScheduledMatch(s)) };
    this.appendLog(`Schedule replaced from ${source}`);
    this.updateCurrentCompetition();
    notify();
  },
  
  setSelectedTeam(team) {
    state = { ...state, selectedTeam: team };
    notify();
  },
  
  getTeamSummaries() {
    return summarize(state.matches, state.pits, state.paths);
  },
  
  getMatchRecords(filter) {
    let res = state.matches;
    if (filter && filter.forMatch) {
      res = res.filter(m => m.matchNumber === filter.forMatch);
    }
    if (filter && filter.forTeam) {
      res = res.filter(m => m.teamNumber === filter.forTeam);
    }
    return res.sort((a, b) => naturalCompare(a.matchNumber, b.matchNumber));
  },
  
  getPitRecord(forTeam) {
    const teamPits = state.pits.filter(p => p.teamNumber === forTeam);
    teamPits.sort((a, b) => b.timestamp - a.timestamp);
    return teamPits[0] || null;
  },
  
  getPathFiles(forTeam) {
    return state.paths.filter(p => p.teamNumber === forTeam);
  },
  
  getScheduledMatch(matchNumber) {
    return state.schedule.find(s => s.matchNumber === matchNumber) || null;
  },
  
  getUniqueMatchNumbers() {
    const set = new Set();
    state.matches.forEach(m => set.add(m.matchNumber));
    state.schedule.forEach(s => set.add(s.matchNumber));
    const arr = Array.from(set);
    arr.sort(naturalCompare);
    return arr;
  },
  
  getVideo(forMatch) {
    return state.videos.find(v => v.inferredMatchNumber === forMatch) || null;
  },
  
  appendLog(message) {
    const entry = `[${new Date().toISOString()}] ${message}`;
    state = { ...state, importLog: [...state.importLog, entry] };
    notify();
  },
  
  loadSampleData() {
    this.importData({
      matches: sampleMatches(),
      pits: samplePits(),
      paths: samplePaths()
    });
    this.appendLog("Loaded sample data.");
  },
  
  exportPicklistCSV() {
    const summaries = this.getTeamSummaries();
    let csv = "Rank,Team,Role,Risk,PickScore,AvgScore,Reliability,Defense,ClimbRate\n";
    for (const s of summaries) {
      csv += `${s.rank},${s.teamNumber},${s.role},${s.riskLabel},${s.pickScore.toFixed(2)},${s.averageScore.toFixed(2)},${s.reliability.toFixed(2)},${s.defenseIndex.toFixed(2)},${(s.climbRate*100).toFixed(0)}%\n`;
    }
    return csv;
  }
};

export default store;
