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
      matches = await fetchApiSportsMatches(apiKey);
      if (matches.length) source = "api-sports";
    }
  } catch (error) {
    apiWarnings.push(`API-Sports: ${error.message}`);
  }

  try {
    if (oddsKey) {
      const oddsRows = await fetchVolleyballOdds(oddsKey);
      matches = mergeOdds(matches, oddsRows);
      const extra = oddsRowsToMatches(oddsRows, matches.length);
      matches = dedupeMatches([...matches, ...extra]);
      if (extra.length) source = source === "demo" ? "odds-api" : `${source}+odds-api`;
    }
  } catch (error) {
    apiWarnings.push(`Odds API: ${error.message}`);
  }

  if (!matches.length) {
    matches = buildDemoMatches();
    source = apiKey || oddsKey ? "demo-fallback" : "demo-no-api-key";
  }

  matches = pickDiverseLeagues(removeFinishedMatches(matches), 120).map((match) => {
    const prediction = buildAdvancedPrediction(match);
    return { ...match, prediction, source: match.source || source, apiWarnings };
  });

  if (filter === "value") return matches.filter((match) => match.prediction.bestPick.valuePercent >= 3);
  if (filter === "risk7") return matches.filter((match) => match.prediction.bestPick.risk >= 7);
  return matches;
}

async function fetchApiSportsMatches(apiKey) {
  const dates = Array.from({ length: 8 }, (_, i) => new Date(Date.now() + i * 86400000).toISOString().slice(0, 10));
  const loaded = [];
  for (const date of dates) {
    const response = await fetch(`${API_SPORTS_BASE}/games?date=${date}`, { headers: { "x-apisports-key": apiKey } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    loaded.push(...(Array.isArray(payload.response) ? payload.response : []));
  }
  return loaded.map((row, index) => makeApiMatch(row, index));
}

function makeApiMatch(row, index) {
  const startsAt = parseGameDate(row.date, row.time);
  const homeTeam = row.teams?.home?.name || row.teams?.home || "Home team";
  const awayTeam = row.teams?.away?.name || row.teams?.away || "Away team";
  const league = row.league?.name || "Volleyball";
  const country = row.country?.name || row.league?.country || "";
  const stats = buildSyntheticStats(homeTeam, awayTeam, league, country);
  return { id: String(row.id || `api-${index}`), league, country, startsAt: startsAt.toISOString(), date: startsAt.toISOString().slice(0, 10), time: startsAt.toISOString().slice(11, 16), moscowTime: formatMoscowTime(startsAt), status: normalizeStatus(row.status), homeTeam, awayTeam, odds: defaultOdds(homeTeam, awayTeam), lines: buildDefaultLines(homeTeam, awayTeam, stats), stats, hasBookmakerOdds: false, source: "api-sports" };
}

async function fetchVolleyballOdds(oddsKey) {
  const sportsResponse = await fetch(`${ODDS_BASE}/sports/?apiKey=${oddsKey}`);
  if (!sportsResponse.ok) throw new Error(`sports HTTP ${sportsResponse.status}`);
  const sports = await sportsResponse.json();
  const keys = sports.filter((sport) => String(sport.key || "").toLowerCase().includes("volleyball")).map((sport) => sport.key).slice(0, 12);
  const all = [];
  for (const key of keys) {
    const url = `${ODDS_BASE}/sports/${key}/odds/?apiKey=${oddsKey}&regions=eu,us,uk,au&markets=h2h,totals&oddsFormat=decimal`;
    const response = await fetch(url);
    if (!response.ok) continue;
    const rows = await response.json();
    if (Array.isArray(rows)) all.push(...rows.map((row) => ({ ...row, sport_key: key })));
  }
  return all;
}

function oddsRowsToMatches(rows, offset = 0) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => {
    const homeTeam = row.home_team || row.teams?.[0] || "Home team";
    const awayTeam = row.away_team || row.teams?.[1] || "Away team";
    const startsAt = new Date(row.commence_time || Date.now() + 86400000);
    const league = prettifyLeague(row.sport_title || row.sport_key || "Volleyball");
    const country = league.includes("Women") ? "World" : "";
    const bookmaker = row.bookmakers?.[0];
    const h2h = bookmaker?.markets?.find((market) => market.key === "h2h");
    const totals = bookmaker?.markets?.find((market) => market.key === "totals");
    const over = totals?.outcomes?.find((outcome) => String(outcome.name).toLowerCase() === "over");
    const under = totals?.outcomes?.find((outcome) => String(outcome.name).toLowerCase() === "under");
    const homeOdd = h2h?.outcomes?.find((outcome) => normalize(outcome.name) === normalize(homeTeam))?.price;
    const awayOdd = h2h?.outcomes?.find((outcome) => normalize(outcome.name) === normalize(awayTeam))?.price;
    const stats = buildSyntheticStats(homeTeam, awayTeam, league, country);
    const total = Number(over?.point || under?.point);
    return { id: `odds-${offset + index}-${normalize(homeTeam)}-${normalize(awayTeam)}`, league, country, startsAt: startsAt.toISOString(), date: startsAt.toISOString().slice(0, 10), time: startsAt.toISOString().slice(11, 16), moscowTime: formatMoscowTime(startsAt), status: "scheduled", homeTeam, awayTeam, odds: { home: Number(homeOdd || 1.85), away: Number(awayOdd || 1.85), over: Number(over?.price || 1.85), under: Number(under?.price || 1.85) }, lines: buildDefaultLines(homeTeam, awayTeam, stats, total), stats, bookmaker: bookmaker?.title || "Odds API", hasBookmakerOdds: Boolean(bookmaker), source: "odds-api" };
  });
}

function mergeOdds(matches, oddsRows) {
  if (!Array.isArray(oddsRows) || !oddsRows.length) return matches;
  return matches.map((match) => {
    const found = oddsRows.find((row) => sameTeams(match.homeTeam, match.awayTeam, row.home_team, row.away_team));
    if (!found) return match;
    const bookmaker = found.bookmakers?.[0];
    const h2h = bookmaker?.markets?.find((market) => market.key === "h2h");
    const totals = bookmaker?.markets?.find((market) => market.key === "totals");
    const over = totals?.outcomes?.find((outcome) => String(outcome.name).toLowerCase() === "over");
    const under = totals?.outcomes?.find((outcome) => String(outcome.name).toLowerCase() === "under");
    const homeOdd = h2h?.outcomes?.find((outcome) => normalize(outcome.name) === normalize(found.home_team))?.price;
    const awayOdd = h2h?.outcomes?.find((outcome) => normalize(outcome.name) === normalize(found.away_team))?.price;
    return { ...match, odds: { home: Number(homeOdd || match.odds.home), away: Number(awayOdd || match.odds.away), over: Number(over?.price || match.odds.over), under: Number(under?.price || match.odds.under) }, lines: recalcTeamLines({ ...match.lines, total: Number(over?.point || under?.point || match.lines.total) }, match), bookmaker: bookmaker?.title || "Odds API", hasBookmakerOdds: Boolean(bookmaker) };
  });
}

function buildAdvancedPrediction(match) {
  const safeLines = sanitizeLines(match.lines, match);
  const rawModelTotal = average([match.stats.homeAvgTotal, match.stats.awayAvgTotal, match.stats.h2hAvgTotal]);
  const marketLine = Number(safeLines.total || rawModelTotal);
  const projectedTotal = marketAdjustedTotal(rawModelTotal, marketLine, match);
  const totalEdge = projectedTotal - marketLine;
  const poisson = poissonTotals(projectedTotal, marketLine);
  const formModel = formModelScore(match);
  const oddsModel = oddsModelScore(match);
  const powerModel = powerRatingModel(match, projectedTotal);
  const setsModel = expectedSetsModel(match, totalEdge);
  const monteCarlo = monteCarloModel(match, projectedTotal, marketLine, 900);
  const ensemble = ensembleModel({ poisson, formModel, oddsModel, powerModel, setsModel, monteCarlo });
  const setTotals = buildSetTotals(match, projectedTotal, marketLine, ensemble, monteCarlo);
  const homeProbability = weightedAverage([[ensemble.homeProbability, 0.72], [monteCarlo.homeWinProbability, 0.28]]);
  const awayProbability = 1 - homeProbability;
  const share = calculateTeamTotalShare(match, projectedTotal);
  const homeTeamTotal = projectedTotal * share.home;
  const awayTeamTotal = projectedTotal - homeTeamTotal;
  const setCandidates = setTotals.flatMap((set) => [buildCandidate("Тотал сета", `${set.label} ТБ ${set.line}`, set.overProbability / 100, set.overOdd, set.edge), buildCandidate("Тотал сета", `${set.label} ТМ ${set.line}`, set.underProbability / 100, set.underOdd, -set.edge)]);
  const candidates = [buildCandidate("Тотал матча", `ТБ ${marketLine}`, ensemble.overProbability, marketOdd(match.odds.over, ensemble.overProbability, totalEdge), totalEdge), buildCandidate("Тотал матча", `ТМ ${marketLine}`, ensemble.underProbability, marketOdd(match.odds.under, ensemble.underProbability, -totalEdge), -totalEdge), ...setCandidates, buildCandidate("Победа", match.homeTeam, homeProbability, marketOdd(match.odds.home, homeProbability, homeProbability - implied(match.odds.home)), homeProbability - implied(match.odds.home)), buildCandidate("Победа", match.awayTeam, awayProbability, marketOdd(match.odds.away, awayProbability, awayProbability - implied(match.odds.away)), awayProbability - implied(match.odds.away))].filter((c) => c.odd >= 1.4 && c.probability >= 0.42 && isFiniteNumber(c.edge));
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] || buildCandidate("Нет ставки", "Нет сильного выбора", 0.5, 1.8, 0);
  const risk = calculateRisk(best.probability, Math.abs(best.edge), best.valuePercent);
  return { bestPick: { type: best.type, selection: best.selection, probability: round(best.probability * 100, 1), odd: best.odd, valuePercent: round(best.valuePercent, 1), edge: round(best.edge, 2), risk, riskLabel: risk <= 3 ? "низкий" : risk <= 6 ? "средний" : "высокий" }, totals: { matchLine: marketLine, projectedMatchTotal: round(projectedTotal, 1), projectedHomeTotal: round(homeTeamTotal, 1), projectedAwayTotal: round(awayTeamTotal, 1), homeTotalLine: null, awayTotalLine: null, homeTotalEdge: null, awayTotalEdge: null, hasTeamTotalLines: false, rawModelTotal: round(rawModelTotal, 1), marketWeight: match.hasBookmakerOdds ? "рынок" : "расчётная линия" }, setTotals, models: { poisson: displayModel("Poisson", poisson.overProbability, poisson.underProbability), form: displayModel("Форма", formModel.homeProbability, 1 - formModel.homeProbability), odds: displayModel("Кэфы", oddsModel.homeProbability, 1 - oddsModel.homeProbability), power: displayModel("Power", powerModel.homeProbability, 1 - powerModel.homeProbability), sets: displayModel("Сеты", setsModel.overProbability, 1 - setsModel.overProbability), monteCarlo: displayModel("Monte Carlo", monteCarlo.overProbability, monteCarlo.underProbability), ensemble: displayModel("Ensemble", ensemble.homeProbability, awayProbability) }, poisson, monteCarlo: { simulations: monteCarlo.simulations, expectedTotal: round(monteCarlo.avgTotal, 1), overProbability: round(monteCarlo.overProbability * 100, 1), underProbability: round(monteCarlo.underProbability * 100, 1), homeWinProbability: round(monteCarlo.homeWinProbability * 100, 1), awayWinProbability: round((1 - monteCarlo.homeWinProbability) * 100, 1) }, valueTable: candidates.map((c) => ({ type: c.type, selection: c.selection, odd: c.odd, probability: round(c.probability * 100, 1), valuePercent: round(c.valuePercent, 1), score: round(c.score, 3) })), model: { name: "Dual-source Volleyball Engine v1.1", projectedTotal: round(projectedTotal, 1), rawModelTotal: round(rawModelTotal, 1), lineTotal: marketLine, totalEdge: round(totalEdge, 1), overProbability: round(ensemble.overProbability * 100, 1), underProbability: round(ensemble.underProbability * 100, 1), homeProbability: round(homeProbability * 100, 1), awayProbability: round(awayProbability * 100, 1) }, reasons: ["Модель: Dual-source Volleyball Engine v1.1", "Добавлен второй источник матчей: Odds API теперь не только даёт кэфы, но и добавляет свои матчи/лиги в выдачу", `Источник матча: ${match.source || "api"}`, `Линия: ${marketLine}`, `Прогноз: ${round(projectedTotal, 1)}, перевес ${round(totalEdge, 1)}`] };
}

function buildSetTotals(match, projectedTotal, marketLine, ensemble, monteCarlo) {
  const seed = seedNumber(`${match.id}-${match.league}-${match.homeTeam}-${match.awayTeam}-${marketLine}`);
  const tempo = leagueTempoFactor(match.league, match.country);
  const balance = 1 - Math.min(Math.abs(ensemble.homeProbability - 0.5) * 1.4, 0.3);
  const expectedSets = clamp(3.15 + balance * 0.9 + Math.abs(ensemble.overProbability - 0.5) * 0.6, 3.2, 4.75);
  const base = clamp((marketLine / expectedSets) * tempo, 40.5, 54.5);
  const perSetEdge = (projectedTotal - marketLine) / expectedSets;
  return [1, 2, 3].map((num) => {
    const factor = [1.025, 0.995, 0.972][num - 1] + (((seed >> (num * 3)) % 17) - 8) * 0.008;
    const line = round(toHalfPoint(clamp(base * factor, 40.5, 55.5)), 1);
    const noise = ((((seed + num * 41) % 25) - 12) / 10) * 0.42;
    const edge = round(perSetEdge * [0.95, 0.74, 0.58][num - 1] + noise, 1);
    const projected = round(line + edge, 1);
    const overProbability = clamp(weightedAverage([[0.5 + edge / 10.5, 0.58], [monteCarlo.overProbability, 0.2], [ensemble.overProbability, 0.22]]) * 100, 34, 66);
    return { number: num, label: `${num}-й сет`, line, projected, edge, overProbability: round(overProbability, 1), underProbability: round(100 - overProbability, 1), overOdd: marketOdd(null, overProbability / 100, edge), underOdd: marketOdd(null, (100 - overProbability) / 100, -edge) };
  });
}

function buildDemoMatches() {
  const d1 = new Date().toISOString().slice(0, 10);
  const d2 = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  return [demoMatch("demo-1", "Poland PlusLiga", "Poland", d1, "18:30", "Jastrzebski Wegiel", "Asseco Resovia", 181.5), demoMatch("demo-2", "Italy SuperLega", "Italy", d1, "20:00", "Trentino", "Modena", 176.5), demoMatch("demo-3", "Turkey Efeler Ligi", "Turkey", d2, "21:15", "Fenerbahce", "Galatasaray", 188.5)];
}
function demoMatch(id, league, country, date, time, homeTeam, awayTeam, totalLine) { const startsAt = new Date(`${date}T${time}:00Z`); const stats = buildSyntheticStats(homeTeam, awayTeam, league, country); return { id, league, country, date, time, startsAt: startsAt.toISOString(), moscowTime: formatMoscowTime(startsAt), status: "scheduled", homeTeam, awayTeam, odds: defaultOdds(homeTeam, awayTeam), lines: buildDefaultLines(homeTeam, awayTeam, stats, totalLine), stats, hasBookmakerOdds: false, source: "demo" }; }
function dedupeMatches(matches) { const seen = new Set(); return matches.filter((m) => { const key = `${normalize(m.homeTeam)}-${normalize(m.awayTeam)}-${m.date}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function sameTeams(a, b, c, d) { const ah = normalize(a), aw = normalize(b), ch = normalize(c), cw = normalize(d); return (ah.includes(ch.slice(0, 8)) && aw.includes(cw.slice(0, 8))) || (ah.includes(cw.slice(0, 8)) && aw.includes(ch.slice(0, 8))) || (ch.includes(ah.slice(0, 8)) && cw.includes(aw.slice(0, 8))); }
function prettifyLeague(text = "") { return String(text).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
function pickDiverseLeagues(matches, limit = 120) { const byLeague = new Map(); for (const m of matches) { const k = `${m.country || ""} ${m.league || "Volleyball"}`.trim(); if (!byLeague.has(k)) byLeague.set(k, []); byLeague.get(k).push(m); } const out = []; let added = true; while (added && out.length < limit) { added = false; for (const rows of byLeague.values()) { const n = rows.shift(); if (n) { out.push(n); added = true; if (out.length >= limit) break; } } } return out.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)); }
function removeFinishedMatches(matches) { const now = Date.now(); return matches.filter((m) => { const status = String(m.status || "").toLowerCase(); if (["finished", "after", "ended", "ft", "cancelled", "postponed", "walkover"].some((w) => status.includes(w))) return false; const start = new Date(m.startsAt || `${m.date}T${m.time || "00:00"}:00Z`).getTime(); return !Number.isFinite(start) || start + 150 * 60000 >= now; }).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)); }
function parseGameDate(date, time) { const parsed = new Date(String(date || "").includes("T") ? date : `${date || new Date().toISOString().slice(0, 10)}T${time || "00:00"}:00Z`); return Number.isNaN(parsed.getTime()) ? new Date() : parsed; }
function normalizeStatus(status) { const raw = typeof status === "string" ? status : status?.short || status?.long || "scheduled"; return String(raw || "scheduled").toLowerCase(); }
function sanitizeLines(lines, match) { const fallback = buildDefaultLines(match.homeTeam, match.awayTeam, match.stats, lines?.total); return { total: isRealLine(lines?.total) ? Number(lines.total) : fallback.total, homeTotal: null, awayTotal: null }; }
function marketAdjustedTotal(raw, line, match) { const fd = Math.abs(match.stats.homeForm - match.stats.awayForm); return round(line + clamp((raw - line) * 0.28, -4.5 - fd * 6, 4.5 + fd * 6), 1); }
function calculateTeamTotalShare(match, total) { const avgDiff = (match.stats.homeAvgTotal - match.stats.awayAvgTotal) / Math.max(total, 1); const formDiff = match.stats.homeForm - match.stats.awayForm; const oddsDiff = implied(match.odds.home) - implied(match.odds.away); return { home: clamp(0.5 + avgDiff * 0.14 + formDiff * 0.06 + oddsDiff * 0.04, 0.45, 0.55) }; }
function poissonTotals(total, line) { const p = clamp(0.5 + (total - line) / 38, 0.28, 0.72); return { overProbability: p, underProbability: 1 - p, edge: round(total - line, 1) }; }
function expectedSetsModel(match, edge) { const b = 1 - Math.min(Math.abs(match.stats.homeForm - match.stats.awayForm) * 2.2, 0.35); const es = clamp(3.15 + b * 0.75 + Math.abs(edge) * 0.03, 3.05, 4.35); return { expectedSets: round(es, 2), overProbability: clamp(0.47 + (es - 3.6) * 0.12 + edge / 65, 0.36, 0.64) }; }
function monteCarloModel(match, total, line, simulations = 900) { const rng = seededRandom(seedNumber(`${match.id}-${match.homeTeam}-${match.awayTeam}-${line}`)); const share = calculateTeamTotalShare(match, total); const avgSet = clamp(total / 3.8, 39, 50.5); const balance = 1 - Math.min(Math.abs(match.stats.homeForm - match.stats.awayForm) * 1.8, 0.35); const expSets = clamp(3.2 + balance * 0.75, 3.1, 4.25); let over = 0, homeWins = 0, points = 0; for (let i = 0; i < simulations; i++) { const sets = clamp(Math.round(normalSample(rng, expSets, 0.55)), 3, 5); const t = Math.max(110, sets * avgSet + normalSample(rng, 0, 7.5 + sets * 0.75)); const hp = t * clamp(normalSample(rng, share.home, 0.035), 0.38, 0.62); if (t > line) over++; if (hp > t - hp) homeWins++; points += t; } const op = over / simulations; return { simulations, avgTotal: points / simulations, overProbability: clamp(op, 0.22, 0.78), underProbability: clamp(1 - op, 0.22, 0.78), homeWinProbability: clamp(homeWins / simulations, 0.3, 0.82) }; }
function normalSample(rng, mean, sd) { const u1 = Math.max(rng(), 1e-9), u2 = Math.max(rng(), 1e-9); return mean + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sd; }
function seededRandom(seed) { let s = seed || 123456789; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function formModelScore(match) { return { homeProbability: clamp(0.5 + (match.stats.homeForm - match.stats.awayForm) * 0.48, 0.34, 0.76) }; }
function oddsModelScore(match) { const h = implied(match.odds.home), a = implied(match.odds.away), t = h + a || 1; return { homeProbability: clamp(h / t, 0.32, 0.78) }; }
function powerRatingModel(match, total) { const hp = match.stats.homeAvgTotal * 0.3 + match.stats.homeForm * 70; const ap = match.stats.awayAvgTotal * 0.3 + match.stats.awayForm * 70; return { homeProbability: clamp(0.5 + (hp - ap) / Math.max(total, 1), 0.34, 0.76) }; }
function ensembleModel({ poisson, formModel, oddsModel, powerModel, setsModel, monteCarlo }) { const homeProbability = weightedAverage([[formModel.homeProbability, 0.24], [oddsModel.homeProbability, 0.34], [powerModel.homeProbability, 0.22], [monteCarlo.homeWinProbability, 0.2]]); const overProbability = weightedAverage([[poisson.overProbability, 0.34], [setsModel.overProbability, 0.22], [monteCarlo.overProbability, 0.34], [0.5, 0.1]]); return { homeProbability: clamp(homeProbability, 0.32, 0.8), overProbability: clamp(overProbability, 0.26, 0.74), underProbability: clamp(1 - overProbability, 0.26, 0.74) }; }
function buildCandidate(type, selection, probability, odd, edge) { const valuePercent = (probability * Number(odd || 0) - 1) * 100; return { type, selection, probability, odd: round(odd, 2), edge, valuePercent, score: probability * 0.66 + Math.max(-0.14, Math.min(valuePercent / 100, 0.24)) * 1.45 + Math.min(Math.abs(edge), 8) * 0.01 }; }
function buildSyntheticStats(homeTeam, awayTeam, league = "", country = "") { const hs = seedNumber(`${homeTeam}-${league}`), as = seedNumber(`${awayTeam}-${country}`); const tempo = leagueTempoFactor(league, country); const base = (174 + ((hs + as) % 14)) * tempo; return { homeAvgTotal: base + (hs % 7), awayAvgTotal: base + (as % 7), homeForm: 0.45 + (hs % 35) / 100, awayForm: 0.45 + (as % 35) / 100, h2hAvgTotal: base + ((hs - as) % 9) }; }
function leagueTempoFactor(league = "", country = "") { const text = `${league} ${country}`.toLowerCase(); if (text.includes("women") || text.includes("жен")) return 0.985; if (text.includes("plusliga") || text.includes("superlega")) return 1.035; if (text.includes("nations")) return 1; return 1 + ((seedNumber(text) % 9) - 4) * 0.006; }
function buildDefaultLines(home, away, stats = buildSyntheticStats(home, away), forced = null) { const raw = average([stats.homeAvgTotal, stats.awayAvgTotal, stats.h2hAvgTotal]); return { total: round(Number.isFinite(Number(forced)) && Number(forced) > 80 ? Number(forced) : clamp(raw - 12.5, 160.5, 198.5), 1), homeTotal: null, awayTotal: null }; }
function recalcTeamLines(lines, match) { return { ...buildDefaultLines(match.homeTeam, match.awayTeam, match.stats, lines.total), homeTotal: null, awayTotal: null }; }
function defaultOdds(home = "", away = "") { const h = seedNumber(home), a = seedNumber(away); return { home: round(1.58 + (h % 42) / 100, 2), away: round(1.64 + (a % 58) / 100, 2), over: round(1.72 + ((h + a) % 30) / 100, 2), under: round(1.72 + ((h * 3 + a) % 30) / 100, 2) }; }
function calculateRisk(probability, edge, valuePercent) { return clamp(round(9 - probability * 4.8 - Math.min(edge, 8) * 0.13 - Math.max(-6, valuePercent) * 0.035, 1), 1, 10); }
function marketOdd(bookOdd, p, edge = 0) { if (Number(bookOdd) >= 1.4) return round(Number(bookOdd), 2); return clamp(round((p > 0 ? 1 / p : 1.9) * (1.03 + Math.min(Math.abs(edge), 9) * 0.004), 2), 1.4, 3.2); }
function toHalfPoint(v) { return Math.round(Number(v || 0) * 2) / 2; }
function displayModel(name, a, b) { return { name, first: round(a * 100, 1), second: round(b * 100, 1) }; }
function weightedAverage(rows) { const w = rows.reduce((s, r) => s + r[1], 0) || 1; return rows.reduce((s, r) => s + r[0] * r[1], 0) / w; }
function implied(odd) { const v = Number(odd || 0); return v > 1 ? 1 / v : 0; }
function average(values) { const clean = values.map(Number).filter(Number.isFinite); return clean.length ? clean.reduce((s, v) => s + v, 0) / clean.length : 0; }
function normalize(v) { return String(v || "").toLowerCase().replace(/[^a-zа-я0-9]/gi, ""); }
function seedNumber(text) { return String(text || "").split("").reduce((s, c) => s + c.charCodeAt(0), 0); }
function isFiniteNumber(v) { return Number.isFinite(Number(v)); }
function isRealLine(v) { return Number.isFinite(Number(v)) && Number(v) > 20; }
function formatMoscowTime(date) { const parsed = date instanceof Date ? date : new Date(date); const dateText = parsed.toLocaleDateString("ru-RU", { timeZone: MOSCOW_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" }); const timeText = parsed.toLocaleTimeString("ru-RU", { timeZone: MOSCOW_TIMEZONE, hour: "2-digit", minute: "2-digit" }); const today = new Date().toLocaleDateString("ru-RU", { timeZone: MOSCOW_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" }); const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("ru-RU", { timeZone: MOSCOW_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" }); return { date: dateText, time: timeText, label: dateText === today ? "Сегодня" : dateText === tomorrow ? "Завтра" : dateText }; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function round(v, d = 2) { return Number.parseFloat(Number(v || 0).toFixed(d)); }
