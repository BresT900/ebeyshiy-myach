export async function getVolleyballMatches({ filter = "all" } = {}) {
  const matches = buildDemoMatches().map((match) => {
    const prediction = buildBasicPrediction(match);
    return { ...match, prediction };
  });

  if (filter === "value") {
    return matches.filter((match) => match.prediction.bestPick.valuePercent > 2);
  }

  if (filter === "risk7") {
    return matches.filter((match) => match.prediction.bestPick.risk >= 7);
  }

  return matches;
}

function buildDemoMatches() {
  const today = new Date();
  const dateText = today.toISOString().slice(0, 10);

  return [
    {
      id: "volley-001",
      league: "Poland PlusLiga",
      date: dateText,
      time: "18:30",
      homeTeam: "Jastrzebski Wegiel",
      awayTeam: "Asseco Resovia",
      odds: { home: 1.62, away: 2.22, over: 1.78, under: 1.92 },
      lines: { total: 181.5, homeTotal: 92.5, awayTotal: 88.5 },
      stats: {
        homeAvgTotal: 184.2,
        awayAvgTotal: 178.6,
        homeForm: 0.72,
        awayForm: 0.58,
        h2hAvgTotal: 183.8
      }
    },
    {
      id: "volley-002",
      league: "Italy SuperLega",
      date: dateText,
      time: "20:00",
      homeTeam: "Trentino",
      awayTeam: "Modena",
      odds: { home: 1.44, away: 2.75, over: 1.86, under: 1.86 },
      lines: { total: 176.5, homeTotal: 91.5, awayTotal: 84.5 },
      stats: {
        homeAvgTotal: 174.1,
        awayAvgTotal: 177.9,
        homeForm: 0.78,
        awayForm: 0.49,
        h2hAvgTotal: 175.6
      }
    },
    {
      id: "volley-003",
      league: "Turkey Efeler Ligi",
      date: dateText,
      time: "21:15",
      homeTeam: "Fenerbahce",
      awayTeam: "Galatasaray",
      odds: { home: 1.83, away: 1.96, over: 1.74, under: 2.02 },
      lines: { total: 188.5, homeTotal: 95.5, awayTotal: 93.5 },
      stats: {
        homeAvgTotal: 191.3,
        awayAvgTotal: 189.8,
        homeForm: 0.63,
        awayForm: 0.61,
        h2hAvgTotal: 192.1
      }
    }
  ];
}

function buildBasicPrediction(match) {
  const projectedTotal = average([
    match.stats.homeAvgTotal,
    match.stats.awayAvgTotal,
    match.stats.h2hAvgTotal
  ]);

  const totalEdge = projectedTotal - match.lines.total;
  const overProbability = clamp(0.5 + totalEdge / 35, 0.42, 0.72);
  const underProbability = 1 - overProbability;
  const homeProbability = clamp(0.5 + (match.stats.homeForm - match.stats.awayForm) * 0.55, 0.35, 0.76);
  const awayProbability = 1 - homeProbability;

  const candidates = [
    buildCandidate("Тотал", `ТБ ${match.lines.total}`, overProbability, match.odds.over, totalEdge),
    buildCandidate("Тотал", `ТМ ${match.lines.total}`, underProbability, match.odds.under, -totalEdge),
    buildCandidate("Победа", match.homeTeam, homeProbability, match.odds.home, homeProbability - 0.5),
    buildCandidate("Победа", match.awayTeam, awayProbability, match.odds.away, awayProbability - 0.5)
  ].filter((candidate) => candidate.odd >= 1.4);

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const risk = calculateRisk(best.probability, Math.abs(best.edge));

  return {
    bestPick: {
      type: best.type,
      selection: best.selection,
      probability: round(best.probability * 100, 1),
      odd: best.odd,
      valuePercent: round(best.valuePercent, 1),
      edge: round(best.edge, 1),
      risk,
      riskLabel: risk <= 3 ? "низкий" : risk <= 6 ? "средний" : "высокий"
    },
    model: {
      projectedTotal: round(projectedTotal, 1),
      lineTotal: match.lines.total,
      totalEdge: round(totalEdge, 1),
      overProbability: round(overProbability * 100, 1),
      underProbability: round(underProbability * 100, 1),
      homeProbability: round(homeProbability * 100, 1),
      awayProbability: round(awayProbability * 100, 1)
    },
    reasons: [
      `Расчетный тотал: ${round(projectedTotal, 1)} против линии ${match.lines.total}`,
      `Отклонение от линии: ${round(totalEdge, 1)} очка`,
      `Форма: ${match.homeTeam} ${round(match.stats.homeForm * 100, 0)}%, ${match.awayTeam} ${round(match.stats.awayForm * 100, 0)}%`,
      "Это стартовый демо-движок. Реальные API и расширенные модели подключаются следующим этапом."
    ]
  };
}

function buildCandidate(type, selection, probability, odd, edge) {
  const implied = odd > 1 ? 1 / odd : 0;
  const value = probability - implied;
  return {
    type,
    selection,
    probability,
    odd,
    edge,
    valuePercent: value * 100,
    score: probability * 0.55 + Math.max(0, value) * 1.7 + Math.abs(edge) * 0.015
  };
}

function calculateRisk(probability, edge) {
  const risk = 8 - probability * 6 - Math.min(edge, 8) * 0.25;
  return clamp(round(risk, 1), 1, 10);
}

function average(values) {
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  return Number.parseFloat(Number(value).toFixed(digits));
}
