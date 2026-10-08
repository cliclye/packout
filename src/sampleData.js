import { MatchRecord, PitRecord, RobotPathFile, RobotPathSample } from './models.js';

export function matchRecords() {
  function row(
    team,
    match,
    auto = 5,
    autoMiss = 1,
    tele = 12,
    teleMiss = 3,
    climb = 3,
    broke = 0,
    notes = ""
  ) {
    return new MatchRecord({
      id: `sample:${team}-${match}`,
      sourcePath: "",
      teamNumber: team,
      matchNumber: match,
      autoHub: auto,
      autoHubMissed: autoMiss,
      autoClimb: 1,
      autoClimbLocation: 2,
      teleOpHub: tele,
      teleOpHubMissed: teleMiss,
      teleOpPassed: 2,
      teleOpClimb: climb,
      teleOpClimbLocation: 4,
      defEffectiveness: 2,
      defDuration: 5,
      brokeDuration: broke,
      underDefDuration: 3,
      notes: notes || "Sample row for UI testing.",
      scouterName: "Demo",
      importedAt: new Date()
    });
  }

  const teams = ["971", "1540", "2471", "2990", "2910", "1425"];
  const rows = [];
  const climbPattern = [2, 3, 4, 4, 3, 2];

  for (const match of ["12", "13", "14", "23"]) {
    teams.forEach((team, i) => {
      const climb = climbPattern[i % 6];
      rows.push(row(team, match, 5, 1, 8 + i, 1 + (i % 3), climb, i === 3 ? 12 : 0));
    });
  }

  rows.push(row("971", "30", 5, 1, 12, 3, 3, 0, "Flagship defense sample · late hang attempt."));
  rows.push(row("2471", "30", 5, 1, 12, 3, 3, 25, "Long brownout noted on field."));

  return rows;
}

export function pitRecords() {
  return [
    new PitRecord({ id: "sample:pit-971", sourcePath: "", teamNumber: "971", driveTrain: 2, intake: 4, launcher: 3, width: 30, terrain: 2, notes: "Heavy cycle strategy, prioritized L3.", importedAt: new Date() }),
    new PitRecord({ id: "sample:pit-1540", sourcePath: "", teamNumber: "1540", driveTrain: 2, intake: 3, launcher: 2, width: 28, terrain: 1, notes: "Fast swaps, narrower frame.", importedAt: new Date() }),
    new PitRecord({ id: "sample:pit-2471", sourcePath: "", teamNumber: "2471", driveTrain: 2, intake: 5, launcher: 3, width: 31, terrain: 3, notes: "Under-bumper collector, climb focus.", importedAt: new Date() }),
    new PitRecord({ id: "sample:pit-2990", sourcePath: "", teamNumber: "2990", driveTrain: 1, intake: 2, launcher: 1, width: 27, terrain: 0, notes: "Rookie-ish build cycle; improving.", importedAt: new Date() })
  ];
}

export function pathFiles() {
  function samples(seed) {
    const out = [];
    for (let i = 0; i < 42; i++) {
      const t = i * 0.8;
      const x = Math.min(1, Math.max(0, 0.2 + (i / 60) * (0.5 + seed * 0.05)));
      const y = Math.min(1, Math.max(0, 0.35 + Math.sin(t * 0.25 + seed) * 0.18));
      out.push(new RobotPathSample({ isAuto: i < 14, x, y, time: t }));
    }
    return out;
  }

  return [
    new RobotPathFile({ id: "sample:path-971", teamNumber: "971", sourcePath: "", samples: samples(0.1) }),
    new RobotPathFile({ id: "sample:path-2471", teamNumber: "2471", sourcePath: "", samples: samples(0.6) })
  ];
}
