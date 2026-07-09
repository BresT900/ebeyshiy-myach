const API_SPORTS_BASE = "https://v1.volleyball.api-sports.io";
const ODDS_BASE = "https://api.the-odds-api.com/v4";
const MOSCOW_TIMEZONE = "Europe/Moscow";

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

  matches = removeFinishedMatches(matches);

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
    return { ...match, prediction, source, apiWarnings };
  });

  if (filter === "value") {
    return matches.filter((match) => match.prediction.bestPick.valuePercent >= 3);
  }

  if (filter === "risk7") {
    return matches.filter((match) => match.prediction.bestPick.risk >= 7);
  }

  return matches;
}

async function fetchApiSportsMatches(apiKey) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dates = [today, tomorrow];
  const loaded = [];

  for (const date of dates) {
    const url = `${API_SPORTS_BASE}/games?date=${date}`;
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
    loaded.push(...rows);
  }

  return loaded.slice(0, 40).map((row, index) => {
    const timestamp = parseGameDate(row.date, row.time);
    const homeTeam = row.teams?.home?.name || row.teams?.home || "Home team";
    const awayTeam = row.teams?.away?.name || row.teams?.away || "Away team";

    return {
      id: String(row.id || `api-${index}`),
      league: row.league?.name || "Volleyball",
      country: row.country?.name || row.league?.country || "",
      startsAt: timestamp.toISOString(),
      date: timestamp.toISOString().slice(0, 10),
      time: timestamp.toISOString().slice(11, 16),
      moscowTime: formatMoscowTime(timestamp),
      status: normalizeStatus(row.status),
      homeTeam,
      awayTeam,
      odds: defaultOdds(),
      lines: buildDefaultLines(homeTeam, awayTeam),
      stats: buildSyntheticStats(homeTeam, awayTeam)
    };
  });
}

function parseGameDate(date, time) {
  if (date && String(date).includes("T")) {
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const text = `${date || new Date().toISOString().slice(0, 10)}T${time || "00:00"}:00Z`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeStatus(status) {
  const raw = typeof status === "string" ? status : status?.short || status?.long || "scheduled";
  return String(raw || "scheduled").toLowerCase();
}

function removeFinishedMatches(matches) {
  const now = Date.now();
  const finishedWords = ["finished", "after", "ended", "ft", "aet", "cancelled", "canceled", "postponed", "walkover"];

  return matches
    .filter((match) => {
      const status = String(match.status || "").toLowerCase();
      if (finishedWords.some((word) => status.includes(word))) return false;

      const start = match.startsAt ? new Date(match.startsAt).getTime() : new Date(`${match.date}T${match.time || "00:00"}:00Z`).getTime();
      if (!Number.isFinite(start)) return true;

      return start + 150 * 60 * 1000 >= now;
    })
    .sort((a, b) => new Date(a.startsAt || `${a.date}T${a.time}:00Z`) - new Date(b.startsAt || `${b.date}T${b.time}:00Z`))
    .slice(0, 16);
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
    const found = oddsRows.find((row) => {
      const rowHome = normalize(row.home_team);
      const rowAway = normalize(row.away_team);
      return rowHome.includes(normalizedHome.slice(0, 8)) ||
        rowAway.includes(normalizedAway.slice(0, 8)) ||
        normalizedHome.includes(rowHome.slice(0, 8)) ||
        normalizedAway.includes(rowAway.slice(0, 8));
    });

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
  const now = new Date();
  const dateText = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return [
    demoMatch("volley-001", "Poland PlusLiga", "Poland", dateText, "18:30", "Jastrzebski Wegiel", "Asseco Resovia", { home: 1.62, away: 2.22, over: 1.78, under: 1.92 }, { total: 181.5, homeTotal: 92.5, awayTotal: 88.5 }),
    demoMatch("volley-002", "Italy SuperLega", "Italy", dateText, "20:00", "Trentino", "Modena", { home: 1.44, away: 2.75, over: 1.86, under: 1.86 }, { total: 176.5, homeTotal: 91.5, awayTotal: 84.5 }),
    demoMatch("volley-003", "Turkey Efeler Ligi", "Turkey", dateText, "21:15", "Fenerbahce", "Galatasaray", { home: 1.83, away: 1.96, over: 1.74, under: 2.02 }, { total: 188.5, homeTotal: 95.5, awayTotal: 93.5 })
  ];
}

function demoMatch(id, league, country, date, time, homeTeam, awayTeam, odds, lines) {
  const startsAt = new Date(`${date}T${time}:00Z`);
  return {
    id,
    league,
    country,
    date,
    time,
    startsAt: startsAt.toISOString(),
    moscowTime: formatMoscowTime(startsAt),
    status: "scheduled",
    homeTeam,
    awayTeam,
    odds,
    lines,
    stats: buildSyntheticStats(homeTeam, awayTeam)
  };
}

function buildAdvancedPrediction(match) {
  const projectedTotal = average([match.stats.homeAvgTotal, match.stats.awayAvgTotal, match.stats.h2hAvgTotal]);
  const totalEdge = projectedTotal - match.lines.total;

  const poisson = poissonTotals(projectedTotal, match.lines.total);
  const formModel = formModelScore(match);
  const oddsModel = oddsModelScore(match);
  const powerModel = powerRatingModel(match, projectedTotal);
  const ensemble = ensembleModel({ poisson, formModel, oddsModel, powerModel });

  const homeProbability = ensemble.homeProbability;
  const awayProbability = 1 - homeProbability;
  const homeTeamTotal = projectedTotal * homeProbability;
  const awayTeamTotal = projectedTotal - homeTeamTotal;

  const candidates = [
    buildCandidate("Тотал", `ТБ ${match.lines.total}`, ensemble.overProbability, match.odds.over, totalEdge),
    buildCandidate("Тотал", `ТМ ${match.lines.total}`, ensemble.underProbability, match.odds.under, -totalEdge),
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
    models: {
      poisson: displayModel("Poisson", poisson.overProbability, poisson.underProbability),
      form: displayModel("Форма", formModel.homeProbability, 1 - formModel.homeProbability),
      odds: displayModel("Кэфы", oddsModel.homeProbability, 1 - oddsModel.homeProbability),
      power: displayModel("Power", powerModel.homeProbability, 1 - powerModel.homeProbability),
      ensemble: displayModel("Ensemble", ensemble.homeProbability, awayProbability)
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
      name: "Poisson + Form + Odds + Power Ensemble v0.3",
      projectedTotal: round(projectedTotal, 1),
      lineTotal: match.lines.total,
      totalEdge: round(totalEdge, 1),
      overProbability: round(ensemble.overProbability * 100, 1),
      underProbability: round(ensemble.underProbability * 100, 1),
      homeProbability: round(homeProbability * 100, 1),
      awayProbability: round(awayProbability * 100, 1)
    },
    reasons: [
      "Модель: Poisson + Form + Odds + Power Ensemble v0.3",
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

function formModelScore(match) {
  const diff = match.stats.homeForm - match.stats.awayForm;
  return { homeProbability: clamp(0.5 + diff * 0.52, 0.34, 0.78) };
}

function oddsModelScore(match) {
  const home = implied(match.odds.home);
  const away = implied(match.odds.away);
  const total = home + away || 1;
  return { homeProbability: clamp(home / total, 0.32, 0.78) };
}

function powerRatingModel(match, projectedTotal) {
  const homePower = match.stats.homeAvgTotal * 0.35 + match.stats.homeForm * 100 * 0.65;
  const awayPower = match.stats.awayAvgTotal * 0.35 + match.stats.awayForm * 100 * 0.65;
  const diff = (homePower - awayPower) / Math.max(projectedTotal, 1);
  return { homeProbability: clamp(0.5 + diff, 0.34, 0.78) };
}

function ensembleModel({ poisson, formModel, oddsModel, powerModel }) {
  const homeProbability = weightedAverage([
    [formModel.homeProbability, 0.34],
    [oddsModel.homeProbability, 0.33],
    [powerModel.homeProbability, 0.33]
  ]);

  const overProbability = weightedAverage([
    [poisson.overProbability, 0.55],
    [clamp(0.5 + (powerModel.homeProbability - 0.5) * 0.22, 0.42, 0.62), 0.20],
    [clamp(0.5 + (formModel.homeProbability - 0.5) * 0.18, 0.42, 0.62), 0.25]
  ]);

  return {
    homeProbability: clamp(homeProbability, 0.32, 0.80),
    overProbability: clamp(overProbability, 0.08, 0.92),
    underProbability: clamp(1 - overProbability, 0.08, 0.92)
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

function displayModel(name, a, b) {
  return {
    name,
    first: round(a * 100, 1),
    second: round(b * 100, 1)
  };
}

function weightedAverage(rows) {
  const totalWeight = rows.reduce((sum, row) => sum + row[1], 0) || 1;
  return rows.reduce((sum, row) => sum + row[0] * row[1], 0) / totalWeight;
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

function formatMoscowTime(date) {
  const parsed = date instanceof Date ? date : new Date(date);
  const dateText = parsed.toLocaleDateString("ru-RU", { timeZone: MOSCOW_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" });
  const timeText = parsed.toLocaleTimeString("ru-RU", { timeZone: MOSCOW_TIMEZONE, hour: "2-digit", minute: "2-digit" });
  const today = new Date().toLocaleDateString("ru-RU", { timeZone: MOSCOW_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" });
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString("ru-RU", { timeZone: MOSCOW_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" });

  return {
    date: dateText,
    time: timeText,
    label: dateText === today ? "Сегодня" : dateText === tomorrow ? "Завтра" : dateText
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}
