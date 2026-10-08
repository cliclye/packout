export class MatchRecord {
  constructor(data = {}) {
    this.id = data.id || ('match_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
    this.sourcePath = data.sourcePath || '';
    this.teamNumber = (data.teamNumber || '').toString().trim();
    this.matchNumber = (data.matchNumber || '').toString().trim();
    this.autoHub = parseInt(data.autoHub || 0, 10);
    this.autoHubMissed = parseInt(data.autoHubMissed || 0, 10);
    this.autoClimb = parseInt(data.autoClimb || 0, 10);
    this.autoClimbLocation = Math.max(1, parseInt(data.autoClimbLocation || 1, 10));
    this.teleOpHub = parseInt(data.teleOpHub || 0, 10);
    this.teleOpHubMissed = parseInt(data.teleOpHubMissed || 0, 10);
    this.teleOpPassed = parseFloat(data.teleOpPassed || 0);
    this.teleOpClimb = parseInt(data.teleOpClimb || 0, 10);
    this.teleOpClimbLocation = Math.max(1, parseInt(data.teleOpClimbLocation || 1, 10));
    this.defEffectiveness = parseInt(data.defEffectiveness || 0, 10);
    this.defDuration = parseInt(data.defDuration || 0, 10);
    this.brokeDuration = parseInt(data.brokeDuration || 0, 10);
    this.underDefDuration = parseInt(data.underDefDuration || 0, 10);
    this.notes = data.notes || '';
    this.scouterName = data.scouterName || '';
    this.importedAt = data.importedAt || new Date();
  }

  get totalMade() {
    return this.autoHub + this.teleOpHub;
  }

  get totalMissed() {
    return this.autoHubMissed + this.teleOpHubMissed;
  }

  get totalAttempts() {
    return this.totalMade + this.totalMissed;
  }

  get shootingEfficiency() {
    return this.totalAttempts === 0 ? 0 : this.totalMade / this.totalAttempts;
  }

  get estimatedScore() {
    const climb = MatchRecord.climbPoints(this.teleOpClimb);
    const autoClimbBonus = this.autoClimb > 1 ? 2.0 : 0.0;
    return (this.autoHub * 3) + (this.teleOpHub * 2) + (this.teleOpPassed * 0.5) + climb + autoClimbBonus;
  }

  get climbLabel() {
    return MatchRecord.climbLabel(this.teleOpClimb);
  }

  static climbLabel(value) {
    switch (value) {
      case 1: return 'Fail';
      case 2: return 'L1';
      case 3: return 'L2';
      case 4: return 'L3';
      default: return 'None';
    }
  }

  static climbPoints(value) {
    switch (value) {
      case 2: return 4;
      case 3: return 8;
      case 4: return 12;
      default: return 0;
    }
  }
}

export class PitRecord {
  constructor(data = {}) {
    this.id = data.id || ('pit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
    this.sourcePath = data.sourcePath || '';
    this.teamNumber = (data.teamNumber || '').toString().trim();
    this.driveTrain = parseInt(data.driveTrain || 0, 10);
    this.intake = parseInt(data.intake || 0, 10);
    this.launcher = parseInt(data.launcher || 0, 10);
    this.width = parseInt(data.width || 0, 10);
    this.terrain = parseInt(data.terrain || 0, 10);
    this.notes = data.notes || '';
    this.imagePath = data.imagePath || null;
    this.importedAt = data.importedAt || new Date();
  }

  get driveTrainLabel() {
    return ["West Coast", "Mecanum", "Swerve", "Other"][this.driveTrain] || "Unknown";
  }

  get intakeLabel() {
    return ["No Intake", "Source Only", "Split Bumper", "Over Bumper", "Source + Split", "Source + Over"][this.intake] || "Unknown";
  }

  get launcherLabel() {
    return ["No Launcher", "Fixed Hood", "Adjustable Hood", "Adjustable Rotation", "Fully Adjustable"][this.launcher] || "Unknown";
  }

  get terrainLabel() {
    return ["No Traversal", "Bump", "Trench", "Bump + Trench"][this.terrain] || "Unknown";
  }
}

export class ScheduledMatch {
  constructor(data = {}) {
    this.matchNumber = parseInt(data.matchNumber || 0, 10);
    this.name = data.name || `Match ${this.matchNumber}`;
    this.redTeams = (data.redTeams || []).map(t => t.toString());
    this.blueTeams = (data.blueTeams || []).map(t => t.toString());
    this.timeLabel = data.timeLabel || '';
  }

  get id() {
    return this.matchNumber;
  }

  get teams() {
    return [...this.redTeams, ...this.blueTeams];
  }
}

export class RobotPathSample {
  constructor(data = {}) {
    this.id = data.id || ('sample_' + Math.random().toString(36).substr(2, 9));
    this.isAuto = Boolean(data.isAuto);
    this.x = parseFloat(data.x || 0);
    this.y = parseFloat(data.y || 0);
    this.time = parseFloat(data.time || 0);
  }
}

export class RobotPathFile {
  constructor(data = {}) {
    this.id = data.id || ('path_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
    this.teamNumber = (data.teamNumber || '').toString().trim();
    this.sourcePath = data.sourcePath || '';
    this.samples = (data.samples || []).map(s => new RobotPathSample(s));
  }

  get matchCountEstimate() {
    return Math.max(1, this.samples.filter(s => s.time === 0).length);
  }
}

export class VideoAsset {
  constructor(data = {}) {
    this.id = data.id || ('video_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
    this.url = data.url || '';
    this.inferredMatchNumber = data.inferredMatchNumber ? data.inferredMatchNumber.toString().trim() : null;
  }

  get displayName() {
    if (!this.url) return '';
    const parts = this.url.split(/[/\\]/);
    const filename = parts[parts.length - 1];
    return filename.split('.')[0];
  }
}

export class TeamSummary {
  constructor(data = {}) {
    this.id = (data.teamNumber || '').toString();
    this.rank = data.rank || 0;
    this.teamNumber = (data.teamNumber || '').toString();
    this.matchCount = data.matchCount || 0;
    this.pickScore = data.pickScore || 0;
    this.averageScore = data.averageScore || 0;
    this.shootingEfficiency = data.shootingEfficiency || 0;
    this.reliability = data.reliability || 0;
    this.defenseIndex = data.defenseIndex || 0;
    this.averageBrokeSeconds = data.averageBrokeSeconds || 0;
    this.climbRate = data.climbRate || 0;
    this.pathCoverage = data.pathCoverage || 0;
    this.role = data.role || '';
    this.riskLabel = data.riskLabel || '';
    this.flags = data.flags || [];
  }
}

export const AnalysisMetric = {
  pickScore: { id: 'pickScore', title: 'Pick Score', value: (s) => s.pickScore },
  averageScore: { id: 'averageScore', title: 'Avg Score', value: (s) => s.averageScore },
  efficiency: { id: 'efficiency', title: 'Efficiency', value: (s) => s.shootingEfficiency * 100 },
  reliability: { id: 'reliability', title: 'Reliability', value: (s) => s.reliability },
  defense: { id: 'defense', title: 'Defense', value: (s) => s.defenseIndex },
  downtime: { id: 'downtime', title: 'Downtime', value: (s) => s.averageBrokeSeconds }
};
