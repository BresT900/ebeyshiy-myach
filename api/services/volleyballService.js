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

  if (filter === "value") return matches.filter((match) => match.prediction.bestPick.valuePercent >= 3);
  if (filter === "risk7") return matches.filter((match) => match.prediction.bestPick.risk >= 7);
  return matches;
}

async function fetchApiSportsMatches(apiKey) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dates = [today, tomorrow];
  const loaded = [];

  for (const date of dates) {
    const url = `${API_SPORTS_BASE}/games?date=${date}`;
    const response = await fetch(url, { headers: { "x-apisports-key": apiKey } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload.response) ? payload.response : [];
    loaded.push(...rows);
  }

  return loaded.slice(0, 40).map((row, index) => {
    const timestamp = parseGameDate(row.date, row.time);
    const homeTeam = row.teams?.home?.name || row.teams?.home || "Home team";
    const awayTeam = row.teams?.away?.name || row.teams?.away || "Away team";
    const stats = buildSyntheticStats(homeTeam, awayTeam);

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
      odds: defaultOdds(homeTeam, awayTeam),
      lines: buildDefaultLines(homeTeam, awayTeam, stats),
      stats,
      hasBookmakerOdds: false
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
  const volleyballSport = sports.find((sport) => String(sport.key || "").toLowerCase().includes("volleyball"));
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
      return rowHome.includes(normalizedHome.slice(0, 8)) || rowAway.includes(normalizedAway.slice(0, 8)) || normalizedHome.includes(rowHome.slice(0, 8)) || normalizedAway.includes(rowAway.slice(0, 8));
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
      lines: { ...match.lines, total: Number(over?.point || under?.point || match.lines.total) },
      bookmaker: bookmaker?.title || "Odds API",
      hasBookmakerOdds: Boolean(bookmaker)
    };
  });
}

function buildDemoMatches() {
  const now = new Date();
  const dateText = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return [
    demoMatch("volley-001", "Poland PlusLiga", "Poland", dateText, "18:30", "Jastrzebski Wegiel", "Asseco Resovia", { total: 181.5, homeTotal: 92.5, awayTotal: 88.5 }),
    demoMatch("volley-002", "Italy SuperLega", "Italy", dateText, "20:00", "Trentino", "Modena", { total: 176.5, homeTotal: 91.5, awayTotal: 84.5 }),
    demoMatch("volley-003", "Turkey Efeler Ligi", "Turkey", dateText, "21:15", "Fenerbahce", "Galatasaray", { total: 188.5, homeTotal: 95.5, awayTotal: 93.5 })
  ];
}

function demoMatch(id, league, country, date, time, homeTeam, awayTeam, lines) {
  const startsAt = new Date(`${date}T${time}:00Z`);
  const stats = buildSyntheticStats(homeTeam, awayTeam);
  return { id, league, country, date, time, startsAt: startsAt.toISOString(), moscowTime: formatMoscowTime(startsAt), status: "scheduled", homeTeam, awayTeam, odds: defaultOdds(homeTeam, awayTeam), lines, stats, hasBookmakerOdds: false };
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
  const teamShare = calculateTeamTotalShare(match, projectedTotal);
  const homeTeamTotal = projectedTotal * teamShare.home;
  const awayTeamTotal = projectedTotal - homeTeamTotal;
  const homeTotalEdge = homeTeamTotal - match.lines.homeTotal;
  const awayTotalEdge = awayTeamTotal - match.lines.awayTotal;
  const homeTeamTotalProbability = teamTotalProbability(homeTotalEdge);
  const awayTeamTotalProbability = teamTotalProbability(awayTotalEdge);

  const candidates = [
    buildCandidate("Тотал матча", `ТБ ${match.lines.total}`, ensemble.overProbability, marketOdd(match.odds.over, ensemble.overProbability, totalEdge), totalEdge),
    buildCandidate("Тотал матча", `ТМ ${match.lines.total}`, ensemble.underProbability, marketOdd(match.odds.under, ensemble.underProbability, -totalEdge), -totalEdge),
    buildCandidate("Тотал команды", `${match.homeTeam} ИТБ ${match.lines.homeTotal}`, homeTeamTotalProbability.over, marketOdd(null, homeTeamTotalProbability.over, homeTotalEdge), homeTotalEdge),
    buildCandidate("Тотал команды", `${match.homeTeam} ИТМ ${match.lines.homeTotal}`, homeTeamTotalProbability.under, marketOdd(null, homeTeamTotalProbability.under, -homeTotalEdge), -homeTotalEdge),
    buildCandidate("Тотал команды", `${match.awayTeam} ИТБ ${match.lines.awayTotal}`, awayTeamTotalProbability.over, marketOdd(null, awayTeamTotalProbability.over, awayTotalEdge), awayTotalEdge),
    buildCandidate("Тотал команды", `${match.awayTeam} ИТМ ${match.lines.awayTotal}`, awayTeamTotalProbability.under, marketOdd(null, awayTeamTotalProbability.under, -awayTotalEdge), -awayTotalEdge),
    buildCandidate("Победа", match.homeTeam, homeProbability, marketOdd(match.odds.home, homeProbability, homeProbability - implied(match.odds.home)), homeProbability - implied(match.odds.home)),
    buildCandidate("Победа", match.awayTeam, awayProbability, marketOdd(match.odds.away, awayProbability, awayProbability - implied(match.odds.away)), awayProbability - implied(match.odds.away))
  ].filter((candidate) => candidate.odd >= 1.4 && candidate.probability >= 0.42);

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] || buildCandidate("Нет ставки", "Нет сильного выбора", 0.5, 1.8, 0);
  const risk = calculateRisk(best.probability, Math.abs(best.edge), best.valuePercent);

  return {
    bestPick: { type: best.type, selection: best.selection, probability: round(best.probability * 100, 1), odd: best.odd, valuePercent: round(best.valuePercent, 1), edge: round(best.edge, 2), risk, riskLabel: risk <= 3 ? "низкий" : risk <= 6 ? "средний" : "высокий" },
    totals: { matchLine: match.lines.total, projectedMatchTotal: round(projectedTotal, 1), projectedHomeTotal: round(homeTeamTotal, 1), projectedAwayTotal: round(awayTeamTotal, 1), homeTotalLine: match.lines.homeTotal, awayTotalLine: match.lines.awayTotal, homeTotalEdge: round(homeTotalEdge, 1), awayTotalEdge: round(awayTotalEdge, 1) },
    models: { poisson: displayModel("Poisson", poisson.overProbability, poisson.underProbability), form: displayModel("Форма", formModel.homeProbability, 1 - formModel.homeProbability), odds: displayModel("Кэфы", oddsModel.homeProbability, 1 - oddsModel.homeProbability), power: displayModel("Power", powerModel.homeProbability, 1 - powerModel.homeProbability), ensemble: displayModel("Ensemble", ensemble.homeProbability, awayProbability) },
    poisson,
    valueTable: candidates.map((candidate) => ({ type: candidate.type, selection: candidate.selection, odd: candidate.odd, probability: round(candidate.probability * 100, 1), valuePercent: round(candidate.valuePercent, 1), score: round(candidate.score, 3) })),
    model: { name: "Poisson + Form + Odds + Power Ensemble v0.5", projectedTotal: round(projectedTotal, 1), lineTotal: match.lines.total, totalEdge: round(totalEdge, 1), overProbability: round(ensemble.overProbability * 100, 1), underProbability: round(ensemble.underProbability * 100, 1), homeProbability: round(homeProbability * 100, 1), awayProbability: round(awayProbability * 100, 1) },
    reasons: ["Модель: Poisson + Form + Odds + Power Ensemble v0.5", "Убраны одинаковые value/risk: каждый рынок теперь оценивается отдельно", `Расчётный тотал: ${round(projectedTotal, 1)} против линии ${match.lines.total}`, `Инд. тоталы: ${match.homeTeam} ${round(homeTeamTotal, 1)} против ${match.lines.homeTotal}, ${match.awayTeam} ${round(awayTeamTotal, 1)} против ${match.lines.awayTotal}`, `Value лучшего выбора: ${round(best.valuePercent, 1)}%`, `Риск: ${risk}/10 (${risk <= 3 ? "низкий" : risk <= 6 ? "средний" : "высокий"})`]
  };
}

function calculateTeamTotalShare(match, projectedTotal) {
  const total = Math.max(projectedTotal, 1);
  const avgDiff = (match.stats.homeAvgTotal - match.stats.awayAvgTotal) / total;
  const formDiff = match.stats.homeForm - match.stats.awayForm;
  const oddsDiff = implied(match.odds.home) - implied(match.odds.away);
  const home = clamp(0.5 + avgDiff * 0.18 + formDiff * 0.07 + oddsDiff * 0.04, 0.44, 0.56);
  return { home, away: 1 - home };
}

function poissonTotals(projectedTotal, line) {
  const diff = projectedTotal - line;
  const overProbability = clamp(0.5 + diff / 52, 0.18, 0.82);
  return { model: "Poisson totals", overProbability, underProbability: 1 - overProbability, edge: round(diff, 1) };
}

function teamTotalProbability(edge) {
  const over = clamp(0.5 + edge / 38, 0.20, 0.80);
  return { over, under: 1 - over };
}

function marketOdd(bookOdd, probability, edge = 0) {
  if (Number(bookOdd) >= 1.4) return round(Number(bookOdd), 2);
  const fair = probability > 0 ? 1 / probability : 1.9;
  const margin = 1.05 + Math.min(Math.abs(edge), 12) * 0.006;
  return clamp(round(fair * margin, 2), 1.4, 3.2);
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
  const homeProbability = weightedAverage([[formModel.homeProbability, 0.34], [oddsModel.homeProbability, 0.33], [powerModel.homeProbability, 0.33]]);
  const overProbability = weightedAverage([[poisson.overProbability, 0.60], [clamp(0.5 + (powerModel.homeProbability - 0.5) * 0.16, 0.45, 0.55), 0.20], [clamp(0.5 + (formModel.homeProbability - 0.5) * 0.12, 0.45, 0.55), 0.20]]);
  return { homeProbability: clamp(homeProbability, 0.32, 0.80), overProbability: clamp(overProbability, 0.18, 0.82), underProbability: clamp(1 - overProbability, 0.18, 0.82) };
}

function buildCandidate(type, selection, probability, odd, edge) {
  const valuePercent = (probability * Number(odd || 0) - 1) * 100;
  const edgeBonus = Math.min(Math.abs(edge), 12) * 0.012;
  const valueBonus = Math.max(-0.12, Math.min(valuePercent / 100, 0.35));
  return { type, selection, probability, odd: round(odd, 2), edge, valuePercent, score: probability * 0.65 + valueBonus * 1.7 + edgeBonus };
}

function buildSyntheticStats(homeTeam, awayTeam) {
  const homeSeed = seedNumber(homeTeam);
  const awaySeed = seedNumber(awayTeam);
  const base = 172 + ((homeSeed + awaySeed) % 24);
  return { homeAvgTotal: base + (homeSeed % 9), awayAvgTotal: base + (awaySeed % 9), homeForm: 0.45 + (homeSeed % 35) / 100, awayForm: 0.45 + (awaySeed % 35) / 100, h2hAvgTotal: base + ((homeSeed - awaySeed) % 11) };
}

function buildDefaultLines(homeTeam, awayTeam, stats = buildSyntheticStats(homeTeam, awayTeam)) {
  const total = round(average([stats.homeAvgTotal, stats.awayAvgTotal, stats.h2hAvgTotal]) - 1.5, 1);
  const share = clamp(0.5 + (stats.homeAvgTotal - stats.awayAvgTotal) / Math.max(total, 1) * 0.12, 0.47, 0.53);
  return { total, homeTotal: round(total * share, 1), awayTotal: round(total * (1 - share), 1) };
}

function defaultOdds(homeTeam = "", awayTeam = "") {
  const homeSeed = seedNumber(homeTeam);
  const awaySeed = seedNumber(awayTeam);
  const home = round(1.58 + (homeSeed % 42) / 100, 2);
  const away = round(1.64 + (awaySeed % 58) / 100, 2);
  const over = round(1.72 + ((homeSeed + awaySeed) % 30) / 100, 2);
  const under = round(1.72 + ((homeSeed * 3 + awaySeed) % 30) / 100, 2);
  return { home, away, over, under };
}

function calculateRisk(probability, edge, valuePercent) {
  const risk = 9.2 - probability * 5.2 - Math.min(edge, 14) * 0.16 - Math.max(-8, valuePercent) * 0.045;
  return clamp(round(risk, 1), 1, 10);
}

function displayModel(name, a, b) { return { name, first: round(a * 100, 1), second: round(b * 100, 1) }; }
function weightedAverage(rows) { const totalWeight = rows.reduce((sum, row) => sum + row[1], 0) || 1; return rows.reduce((sum, row) => sum + row[0] * row[1], 0) / totalWeight; }
function implied(odd) { const value = Number(odd || 0); return value > 1 ? 1 / value : 0; }
function average(values) { const clean = values.map(Number).filter(Number.isFinite); return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0; }
function normalize(value) { return String(value || "").toLowerCase().replace(/[^a-zа-я0-9]/gi, ""); }
function seedNumber(text) { return String(text || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0); }

function formatMoscowTime(date) {
  const parsed = date instanceof Date ? date : new Date(date);
  const dateText = parsed.toLocaleDateString("ru-RU", { timeZone: MOSCOW_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" });
  const timeText = parsed.toLocaleTimeString("ru-RU", { timeZone: MOSCOW_TIMEZONE, hour: "2-digit", minute: "2-digit" });
  const today = new Date().toLocaleDateString("ru-RU", { timeZone: MOSCOW_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" });
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString("ru-RU", { timeZone: MOSCOW_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" });
  return { date: dateText, time: timeText, label: dateText === today ? "Сегодня" : dateText === tomorrow ? "Завтра" : dateText };
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function round(value, digits = 2) { return Number.parseFloat(Number(value || 0).toFixed(digits)); }
