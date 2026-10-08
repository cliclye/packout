import { TeamSummary } from './models.js';

function naturalCompare(a, b) {
  const numA = parseInt(a.replace(/\D/g, '') || "0", 10);
  const numB = parseInt(b.replace(/\D/g, '') || "0", 10);
  return numA - numB;
}

export function summarize(matches, pits, paths) {
  const groups = {};
  matches.forEach(m => {
    if (!groups[m.teamNumber]) groups[m.teamNumber] = { matches: [] };
    groups[m.teamNumber].matches.push(m);
  });
  
  const summaries = [];
  
  for (const team in groups) {
    const teamMatches = groups[team].matches;
    const matchCount = teamMatches.length;
    
    let totalScore = 0;
    let totalEff = 0;
    let totalBroke = 0;
    let totalDefDur = 0;
    let totalDefRat = 0;
    let climbCount = 0;
    
    const scores = [];
    const flags = [];
    
    let hasBreakdownFlag = false;
    let hasDefenseFlag = false;
    let hasMobilityFlag = false;
    let hasNoShowFlag = false;
    
    for (const m of teamMatches) {
      const s = m.estimatedScore;
      totalScore += s;
      scores.push(s);
      totalEff += m.shootingEfficiency;
      totalBroke += m.brokeDuration;
      totalDefDur += m.defDuration;
      totalDefRat += m.defEffectiveness;
      if (m.teleOpClimb > 1) climbCount++;
      
      const n = (m.notes || "").toLowerCase();
      if (!hasBreakdownFlag && (n.includes('broke') || n.includes('disabled') || n.includes('dead'))) {
        flags.push("Breakdowns");
        hasBreakdownFlag = true;
      }
      if (!hasDefenseFlag && (n.includes('defense') || n.includes('blocked') || n.includes('pinned'))) {
        flags.push("Defense");
        hasDefenseFlag = true;
      }
      if (!hasMobilityFlag && (n.includes('slow') || n.includes('stuck') || n.includes('jam'))) {
        flags.push("Mobility");
        hasMobilityFlag = true;
      }
      if (!hasNoShowFlag && (n.includes('no show') || n.includes('noshow') || n.includes('absent'))) {
        flags.push("No-show");
        hasNoShowFlag = true;
      }
    }
    
    if (matchCount < 3) flags.push("Low sample");
    
    const avgScore = totalScore / matchCount;
    const avgEfficiency = totalEff / matchCount;
    const avgBroke = totalBroke / matchCount;
    const avgDefenseDuration = totalDefDur / matchCount;
    const avgDefenseRating = totalDefRat / matchCount;
    const climbRate = climbCount / matchCount;
    
    let scoreStdDev = 0;
    if (matchCount > 1) {
      const variance = scores.reduce((acc, val) => acc + Math.pow(val - avgScore, 2), 0) / (matchCount - 1);
      scoreStdDev = Math.sqrt(variance);
    }
    
    let pathCoverage = 0;
    paths.filter(p => p.teamNumber === team).forEach(p => {
      pathCoverage += p.samples.length;
    });
    
    const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
    
    let consistency = 0;
    if (avgScore > 0) {
      consistency = clamp(100 - (scoreStdDev / Math.max(avgScore, 1) * 100), 0, 100);
    }
    
    const availability = clamp(100 - (avgBroke / 135 * 100), 0, 100);
    const coverage = clamp(matchCount / 6 * 100, 0, 100);
    
    const reliability = 0.52 * consistency + 0.28 * availability + 0.20 * coverage;
    const defenseIndex = clamp((avgDefenseRating / 5 * 62) + (avgDefenseDuration / 135 * 38), 0, 100);
    
    let risk = "Low";
    if (avgBroke >= 25 || hasBreakdownFlag) {
      risk = "High";
    } else if (reliability < 45 || flags.length >= 2) {
      risk = "Medium";
    }
    
    groups[team].data = {
      teamNumber: team,
      matchCount,
      avgScore,
      avgEfficiency,
      avgBroke,
      avgDefenseDuration,
      avgDefenseRating,
      climbRate,
      pathCoverage,
      consistency,
      availability,
      coverage,
      reliability,
      defenseIndex,
      risk,
      flags
    };
  }
  
  let maxScore = 1;
  for (const t in groups) {
    if (groups[t].data.avgScore > maxScore) maxScore = groups[t].data.avgScore;
  }
  
  const intermediate = [];
  for (const t in groups) {
    const d = groups[t].data;
    const offenseIndex = d.avgScore / maxScore * 100;
    const efficiencyIndex = d.avgEfficiency * 100;
    const climbIndex = d.climbRate * 100;
    
    const pickScore = 0.43 * offenseIndex + 0.24 * d.reliability + 0.18 * efficiencyIndex + 0.08 * d.defenseIndex + 0.07 * climbIndex;
    d.pickScore = pickScore;
    intermediate.push(d);
  }
  
  intermediate.sort((a, b) => {
    if (b.pickScore !== a.pickScore) return b.pickScore - a.pickScore;
    return naturalCompare(a.teamNumber, b.teamNumber);
  });
  
  const count = intermediate.length;
  intermediate.forEach((d, i) => {
    const rank = i + 1;
    let role = "Depth";
    if (rank <= 8) {
      role = "Captain Core";
    } else if (d.defenseIndex >= 70 && d.reliability >= 55) {
      role = "Defense Anchor";
    } else if (d.avgEfficiency >= 0.70 && d.avgScore >= 8) {
      role = "Efficient Scorer";
    } else if (d.climbRate >= 0.70) {
      role = "Endgame Value";
    } else if (rank <= Math.max(16, count / 3)) {
      role = "First Round";
    }
    
    summaries.push(new TeamSummary({
      rank,
      teamNumber: d.teamNumber,
      matchCount: d.matchCount,
      pickScore: d.pickScore,
      averageScore: d.avgScore,
      shootingEfficiency: d.avgEfficiency,
      reliability: d.reliability,
      defenseIndex: d.defenseIndex,
      averageBrokeSeconds: d.avgBroke,
      climbRate: d.climbRate,
      pathCoverage: d.pathCoverage,
      role,
      riskLabel: d.risk,
      flags: d.flags
    }));
  });
  
  return summaries;
}
