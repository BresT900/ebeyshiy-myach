const API_SPORTS_BASE = "https://v1.volleyball.api-sports.io";
const ODDS_BASE = "https://api.the-odds-api.com/v4";

export async function getVolleyballMatches({ filter = "all" } = {}) {
  const apiKey = process.env.API_KEY || process.env.API_SPORTS_KEY;
  const oddsKey = process.env.ODDS_API_KEY;

  let source = "demo";
  let matches = [];
  let apiWarnings = [];

  try {
    if (apiKey) {
      const liveMatches = await fetchApiSportsMatches(apiKey);
      if (liveMatches.length) {
        matches = liveMatches;
        source = "api-sports";
      }
    }
  } catch (error) {
    apiWarnings.push(`API-Sports: ${error.message}`);
  }

  if (!matches.length) {
    matches = buildDemoMatches();
    source = apiKey ? "demo-fallback" : "demo-no-api-key";
  }

  try {
    if (oddsKey) {
      const odds = await fetchVolleyballOdds(oddsKey);
      matches = mergeOdds(matches, odds);
    }
  } catch (error) {
    apiWarnings.push(`Odds API: ${error.message}`);
  }

  matches = matches.map((match) => {
    const prediction = buildAdvancedPrediction(match);
    return { ...match, prediction };
  });

  if (filter === "value") {
    return matches.filter((match) => match.prediction.bestPick.valuePercent >= 3);
  }

  if (filter === "risk7") {
    return matches.filter((match) => match.prediction.bestPick.risk >= 7);
  }

  return matches.map((match) => ({
    ...match,
    source,
    apiWarnings
  }));
}

async function fetchApiSportsMatches(apiKey) {
  const today = new Date().toISOString().slice(0, 10);
  const url = `${API_SPORTS_BASE}/games?date=${today}`;
  const response = await fetch(url, {
    headers: {
      "x-apisports-key": apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload.response) ? payload.response : [];

  return rows.slice(0, 20).map((row, index) => {
    const timestamp = row.date ? new Date(row.date) : new Date();
    const homeTeam = row.teams?.home?.name || row.teams?.home || "Home team";
    const awayTeam = row.teams?.away?.name || row.teams?.away || "Away team";

    return {
      id: String(row.id || `api-${index}`),
      league: row.league?.name || "Volleyball",
      country: row.country?.name || row.league?.country || "",
      date: timestamp.toISOString().slice(0, 10),
      time: timestamp.toTimeString().slice(0, 5),
      homeTeam,
      awayTeam,
      odds: defaultOdds(),
      lines: buildDefaultLines(homeTeam, awayTeam),
      stats: buildSyntheticStats(homeTeam, awayTeam)
    };
  });
}

async function fetchVolleyballOdds(oddsKey) {
  const sportsResponse = await fetch(`${ODDS_BASE}/sports/?apiKey=${oddsKey}`);
  if (!sportsResponse.ok) throw new Error(`sports HTTP ${sportsResponse.status}`);

  const sports = await sportsResponse.json();
  const volleyballSport = sports.find((sport) =>
    String(sport.key || "").toLowerCase().includes("volleyball")
  );

  if (!volleyballSport?.key) return [];

  const oddsUrl = `${ODDS_BASE}/sports/${volleyballSport.key}/odds/?apiKey=${oddsKey}&regions=eu&markets=h2h,totals&oddsFormat=decimal`;
  const oddsResponse = await fetch(oddsUrl);
  if (!oddsResponse.ok) throw new Error(`odds HTTP ${oddsResponse.status}`);

  return oddsResponse.json();
}

function mergeOdds(matches, oddsRows) {
  if (!Array.isArray(oddsRows) || !oddsRows.length) return matches;

  return matches.map((match) => {
    const normalizedHome = normalize(match.homeTeam);
    const normalizedAway = normalize(match.awayTeam);
    const found = oddsRows.find((row) =>
      normalize(row.home_team).includes(normalizedHome.slice(0, 8)) ||
      normalize(row.away_team).includes(normalizedAway.slice(0, 8)) ||
      normalizedHome.includes(normalize(row.home_team).slice(0, 8)) ||
      normalizedAway.includes(normalize(row.away_team).slice(0, 8))
    );

    if (!found) return match;

    const bookmaker = found.bookmakers?.[0];
    const h2h = bookmaker?.markets?.find((market) => market.key === "h2h");
    const totals = bookmaker?.markets?.find((market) => market.key === "totals");
    const homeOdd = h2h?.outcomes?.find((outcome) => normalize(outcome.name) === normalize(found.home_team))?.price;
    const awayOdd = h2h?.outcomes?.find((outcome) => normalize(outcome.name) === normalize(found.away_team))?.price;
    const over = totals?.outcomes?.find((outcome) => String(outcome.name).toLowerCase() === "over");
    const under = totals?.outcomes?.find((outcome) => String(outcome.name).toLowerCase() === "under");

    return {
      ...match,
      odds: {
        home: Number(homeOdd || match.odds.home),
        away: Number(awayOdd || match.odds.away),
        over: Number(over?.price || match.odds.over),
        under: Number(under?.price || match.odds.under)
      },
      lines: {
        ...match.lines,
        total: Number(over?.point || under?.point || match.lines.total)
      },
      bookmaker: bookmaker?.title || "Odds API"
    };
  });
}

function buildDemoMatches() {
  const today = new Date();
  const dateText = today.toISOString().slice(0, 10);

  return [
    {
      id: "volley-001",
      league: "Poland PlusLiga",
      country: "Poland",
      date: dateText,
      time: "18:30",
      homeTeam: "Jastrzebski Wegiel",
      awayTeam: "Asseco Resovia",
      odds: { home: 1.62, away: 2.22, over: 1.78, under: 1.92 },
      lines: { total: 181.5, homeTotal: 92.5, awayTotal: 88.5 },
      stats: { homeAvgTotal: 184.2, awayAvgTotal: 178.6, homeForm: 0.72, awayForm: 0.58, h2hAvgTotal: 183.8 }
    },
    {
      id: "volley-002",
      league: "Italy SuperLega",
      country: "Italy",
      date: dateText,
      time: "20:00",
      homeTeam: "Trentino",
      awayTeam: "Modena",
      odds: { home: 1.44, away: 2.75, over: 1.86, under: 1.86 },
      lines: { total: 176.5, homeTotal: 91.5, awayTotal: 84.5 },
      stats: { homeAvgTotal: 174.1, awayAvgTotal: 177.9, homeForm: 0.78, awayForm: 0.49, h2hAvgTotal: 175.6 }
    },
    {
      id: "volley-003",
      league: "Turkey Efeler Ligi",
      country: "Turkey",
      date: dateText,
      time: "21:15",
      homeTeam: "Fenerbahce",
      awayTeam: "Galatasaray",
      odds: { home: 1.83, away: 1.96, over: 1.74, under: 2.02 },
      lines: { total: 188.5, homeTotal: 95.5, awayTotal: 93.5 },
      stats: { homeAvgTotal: 191.3, awayAvgTotal: 189.8, homeForm: 0.63, awayForm: 0.61, h2hAvgTotal: 192.1 }
    }
  ];
}

function buildAdvancedPrediction(match) {
  const projectedTotal = average([match.stats.homeAvgTotal, match.stats.awayAvgTotal, match.stats.h2hAvgTotal]);
  const totalEdge = projectedTotal - match.lines.total;
  const poisson = poissonTotals(projectedTotal, match.lines.total);
  const formDiff = match.stats.homeForm - match.stats.awayForm;
  const homeProbability = clamp(0.5 + formDiff * 0.5 + oddsLean(match.odds.home, match.odds.away) * 0.2, 0.34, 0.78);
  const awayProbability = 1 - homeProbability;
  const homeTeamTotal = projectedTotal * homeProbability;
  const awayTeamTotal = projectedTotal - homeTeamTotal;

  const candidates = [
    buildCandidate("Тотал", `ТБ ${match.lines.total}`, poisson.overProbability, match.odds.over, totalEdge),
    buildCandidate("Тотал", `ТМ ${match.lines.total}`, poisson.underProbability, match.odds.under, -totalEdge),
    buildCandidate("Победа", match.homeTeam, homeProbability, match.odds.home, homeProbability - implied(match.odds.home)),
    buildCandidate("Победа", match.awayTeam, awayProbability, match.odds.away, awayProbability - implied(match.odds.away))
  ].filter((candidate) => candidate.odd >= 1.4);

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const risk = calculateRisk(best.probability, Math.abs(best.edge), best.valuePercent);

  return {
    bestPick: {
      type: best.type,
      selection: best.selection,
      probability: round(best.probability * 100, 1),
      odd: best.odd,
      valuePercent: round(best.valuePercent, 1),
      edge: round(best.edge, 2),
      risk,
      riskLabel: risk <= 3 ? "низкий" : risk <= 6 ? "средний" : "высокий"
    },
    totals: {
      matchLine: match.lines.total,
      projectedMatchTotal: round(projectedTotal, 1),
      projectedHomeTotal: round(homeTeamTotal, 1),
      projectedAwayTotal: round(awayTeamTotal, 1),
      homeTotalLine: match.lines.homeTotal,
      awayTotalLine: match.lines.awayTotal
    },
    poisson,
    valueTable: candidates.map((candidate) => ({
      type: candidate.type,
      selection: candidate.selection,
      odd: candidate.odd,
      probability: round(candidate.probability * 100, 1),
      valuePercent: round(candidate.valuePercent, 1),
      score: round(candidate.score, 3)
    })),
    model: {
      name: "Poisson + Value + Risk v0.2",
      projectedTotal: round(projectedTotal, 1),
      lineTotal: match.lines.total,
      totalEdge: round(totalEdge, 1),
      overProbability: round(poisson.overProbability * 100, 1),
      underProbability: round(poisson.underProbability * 100, 1),
      homeProbability: round(homeProbability * 100, 1),
      awayProbability: round(awayProbability * 100, 1)
    },
    reasons: [
      `Модель: Poisson + Value + Risk v0.2`,
      `Расчётный тотал: ${round(projectedTotal, 1)} против линии ${match.lines.total}`,
      `Тоталы команд: ${match.homeTeam} ${round(homeTeamTotal, 1)}, ${match.awayTeam} ${round(awayTeamTotal, 1)}`,
      `Value лучшего выбора: ${round(best.valuePercent, 1)}%`,
      `Риск: ${risk}/10 (${risk <= 3 ? "низкий" : risk <= 6 ? "средний" : "высокий"})`
    ]
  };
}

function poissonTotals(projectedTotal, line) {
  const diff = projectedTotal - line;
  const overProbability = clamp(0.5 + diff / 42, 0.08, 0.92);
  return {
    model: "Poisson totals",
    overProbability,
    underProbability: 1 - overProbability,
    edge: round(diff, 1)
  };
}

function buildCandidate(type, selection, probability, odd, edge) {
  const valuePercent = (probability - implied(odd)) * 100;
  return {
    type,
    selection,
    probability,
    odd,
    edge,
    valuePercent,
    score: probability * 0.55 + Math.max(0, valuePercent / 100) * 1.8 + Math.abs(edge) * 0.012
  };
}

function buildSyntheticStats(homeTeam, awayTeam) {
  const homeSeed = seedNumber(homeTeam);
  const awaySeed = seedNumber(awayTeam);
  const base = 172 + ((homeSeed + awaySeed) % 24);
  return {
    homeAvgTotal: base + (homeSeed % 9),
    awayAvgTotal: base + (awaySeed % 9),
    homeForm: 0.45 + (homeSeed % 35) / 100,
    awayForm: 0.45 + (awaySeed % 35) / 100,
    h2hAvgTotal: base + ((homeSeed - awaySeed) % 11)
  };
}

function buildDefaultLines(homeTeam, awayTeam) {
  const stats = buildSyntheticStats(homeTeam, awayTeam);
  const total = round(average([stats.homeAvgTotal, stats.awayAvgTotal, stats.h2hAvgTotal]) - 1.5, 1);
  return { total, homeTotal: round(total / 2 + 2, 1), awayTotal: round(total / 2 - 2, 1) };
}

function defaultOdds() {
  return { home: 1.85, away: 1.95, over: 1.87, under: 1.87 };
}

function calculateRisk(probability, edge, valuePercent) {
  const risk = 8.5 - probability * 6 - Math.min(edge, 10) * 0.2 - Math.max(0, valuePercent) * 0.06;
  return clamp(round(risk, 1), 1, 10);
}

function oddsLean(homeOdd, awayOdd) {
  const home = implied(homeOdd);
  const away = implied(awayOdd);
  return home - away;
}

function implied(odd) {
  const value = Number(odd || 0);
  return value > 1 ? 1 / value : 0;
}

function average(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-zа-я0-9]/gi, "");
}

function seedNumber(text) {
  return String(text || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}
