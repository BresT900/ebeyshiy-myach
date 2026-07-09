let cachedMatches = [];
let activeTab = "top";

function formatBetupDateTime(match) {
  const parsed = match.startsAt ? new Date(match.startsAt) : new Date(`${match.date || ""}T${match.time || "00:00"}:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    return { date: match.date || "дата не указана", time: match.time || "время не указано", label: match.date || "" };
  }

  const now = new Date();
  const todayKey = localDateKey(now);
  const tomorrowKey = localDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const matchKey = localDateKey(parsed);

  return {
    date: parsed.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }),
    time: parsed.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    label: matchKey === todayKey ? "Сегодня" : matchKey === tomorrowKey ? "Завтра" : parsed.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
  };
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isRealNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function formatNumber(value, fallback = "—") {
  if (!isRealNumber(value)) return fallback;
  return Number(value).toFixed(1);
}

function formatOdd(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number.toFixed(2) : "нет";
}

function getPickClass(pick = {}) {
  const type = String(pick.type || "").toLowerCase();
  if (type.includes("тотал команды")) return "team-total";
  if (type.includes("тотал сета")) return "set-total";
  if (type.includes("тотал")) return "match-total";
  return "winner";
}

function modelRows(models = {}) {
  const rows = Object.values(models || {});
  if (!rows.length) return `<div class="muted">Модели ещё считают.</div>`;
  return rows.map((model) => `
    <div class="model-row">
      <span>${model.name}</span>
      <b>${formatNumber(model.first)}% / ${formatNumber(model.second)}%</b>
    </div>
  `).join("");
}

function valueRows(match) {
  const rows = match.prediction?.valueTable || [];
  const goodRows = rows.filter((row) => Number(row.odd) >= 1.4).slice(0, 8);
  if (!goodRows.length) return `<div class="muted">Value пока не найден.</div>`;

  return goodRows.map((row) => `
    <div class="value-row">
      <div>
        <b>${row.selection}</b>
        <span>${row.type} • кэф ${formatOdd(row.odd)} • вероятность ${formatNumber(row.probability)}%</span>
      </div>
      <strong class="${Number(row.valuePercent) >= 0 ? "green" : "red"}">${formatNumber(row.valuePercent)}%</strong>
    </div>
  `).join("");
}

function renderBestPick(best = {}) {
  return `
    <div class="pick ${getPickClass(best)}">
      <div class="pick-label">Лучший выбор</div>
      <div class="pick-type">${best.type || "Ставка"}</div>
      <div class="pick-selection">${best.selection || "Расчёт..."}</div>
      <div class="pick-stats">
        <span>Кэф ${formatOdd(best.odd)}</span>
        <span>${best.probability || "0"}%</span>
        <span>Value ${formatNumber(best.valuePercent)}%</span>
        <span>Риск ${best.risk || "—"}/10</span>
      </div>
    </div>
  `;
}

function renderTotals(match, totals = {}, model = {}) {
  const teamBlocks = totals.hasTeamTotalLines ? `
    <div class="total-card">
      <span>Инд. тотал 1</span>
      <b>${match.homeTeam}</b>
      <strong>${formatNumber(totals.projectedHomeTotal)}</strong>
      <small>Линия: ${formatNumber(totals.homeTotalLine, "нет линии")} • перевес ${formatNumber(totals.homeTotalEdge)}</small>
    </div>
    <div class="total-card">
      <span>Инд. тотал 2</span>
      <b>${match.awayTeam}</b>
      <strong>${formatNumber(totals.projectedAwayTotal)}</strong>
      <small>Линия: ${formatNumber(totals.awayTotalLine, "нет линии")} • перевес ${formatNumber(totals.awayTotalEdge)}</small>
    </div>
  ` : `
    <div class="total-card muted-card">
      <span>Индивидуальные тоталы</span>
      <b>линии нет</b>
      <small>Букмекер не отдал ИТБ/ИТМ, поэтому ставка на ИТ не предлагается.</small>
    </div>
  `;

  return `
    <div class="totals-panel">
      <div class="total-card main-total">
        <span>Тотал матча</span>
        <b>${formatNumber(totals.projectedMatchTotal)}</b>
        <small>Линия: ${formatNumber(totals.matchLine, "нет линии")}</small>
        <em>ТБ ${formatNumber(model.overProbability)}% / ТМ ${formatNumber(model.underProbability)}%</em>
      </div>
      ${teamBlocks}
    </div>
  `;
}

function renderSetTotals(setTotals = []) {
  if (!Array.isArray(setTotals) || !setTotals.length) return "";
  return `
    <div class="set-totals-panel">
      <h3>Тоталы сетов</h3>
      ${setTotals.slice(0, 3).map((set) => `
        <div class="set-total-row">
          <div>
            <b>${set.label}</b>
            <span>Линия ${formatNumber(set.line)} • прогноз ${formatNumber(set.projected)} • перевес ${formatNumber(set.edge)}</span>
          </div>
          <div class="set-probs">
            <span>ТБ ${formatNumber(set.overProbability)}% / ${formatOdd(set.overOdd)}</span>
            <span>ТМ ${formatNumber(set.underProbability)}% / ${formatOdd(set.underOdd)}</span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderMatch(match, compact = false) {
  const prediction = match.prediction || {};
  const best = prediction.bestPick || {};
  const totals = prediction.totals || {};
  const model = prediction.model || {};
  const dt = formatBetupDateTime(match);

  return `
    <div class="match">
      <div class="match-top">
        <div>
          <div class="small">${match.league || "Волейбол"}${match.country ? ` • ${match.country}` : ""}</div>
          <h2>${match.homeTeam} <span class="vs">VS</span> ${match.awayTeam}</h2>
        </div>
        <div class="source-badge">${match.source || "api"}</div>
      </div>

      <div class="teams">
        <span>${dt.label ? `${dt.label} • ` : ""}${dt.time}</span>
        <span>${dt.date}</span>
      </div>

      ${renderBestPick(best)}
      ${renderTotals(match, totals, model)}
      ${renderSetTotals(prediction.setTotals)}

      ${compact ? "" : `
        <details>
          <summary>Модели</summary>
          <div class="details-box">${modelRows(prediction.models)}</div>
        </details>
        <details>
          <summary>Value варианты</summary>
          <div class="details-box">${valueRows(match)}</div>
        </details>
        <details>
          <summary>Причины прогноза</summary>
          <div class="details-box"><p><b>${model.name || "Модель"}</b></p>${(prediction.reasons || []).map((reason) => `<p>• ${reason}</p>`).join("")}</div>
        </details>
      `}
    </div>
  `;
}

function getTopMatches(matches) {
  return [...matches]
    .filter((match) => Number(match.prediction?.bestPick?.odd) >= 1.4)
    .sort((a, b) => {
      const av = Number(a.prediction?.bestPick?.valuePercent || 0) + Number(a.prediction?.bestPick?.probability || 0) * 0.08 - Number(a.prediction?.bestPick?.risk || 10) * 0.55;
      const bv = Number(b.prediction?.bestPick?.valuePercent || 0) + Number(b.prediction?.bestPick?.probability || 0) * 0.08 - Number(b.prediction?.bestPick?.risk || 10) * 0.55;
      return bv - av;
    });
}

function renderBestBets(matches) {
  const best = getTopMatches(matches).slice(0, 3);
  if (!best.length) return "";

  return `
    <section class="card best-block">
      <h2>ТОП ставок дня</h2>
      ${best.map((match, index) => {
        const pick = match.prediction.bestPick;
        const dt = formatBetupDateTime(match);
        return `
          <div class="best-row ${getPickClass(pick)}">
            <div class="rank">#${index + 1}</div>
            <div>
              <b>${pick.type}: ${pick.selection}</b>
              <span>${match.homeTeam} — ${match.awayTeam}</span>
              <small>${dt.label ? `${dt.label}, ` : ""}${dt.time} • кэф ${formatOdd(pick.odd)} • value ${formatNumber(pick.valuePercent)}% • риск ${pick.risk}/10</small>
            </div>
          </div>
        `;
      }).join("")}
    </section>
  `;
}

function renderTab(matches) {
  if (activeTab === "top") {
    const top = getTopMatches(matches).slice(0, 8);
    return top.length ? top.map((match) => renderMatch(match)).join("") : `<div class="card">Сильных вариантов от 1.40 пока нет.</div>`;
  }

  if (activeTab === "value") {
    const valueMatches = matches.filter((match) => Number(match.prediction?.bestPick?.valuePercent) >= 0 && Number(match.prediction?.bestPick?.odd) >= 1.4);
    return valueMatches.length ? valueMatches.map((match) => renderMatch(match)).join("") : `<div class="card">Валуйных вариантов пока нет.</div>`;
  }

  if (activeTab === "totals") return matches.map((match) => renderMatch(match, false)).join("");

  if (activeTab === "models") {
    return matches.map((match) => `
      <div class="match">
        <div class="small">${match.league || "Волейбол"}</div>
        <h2>${match.homeTeam} <span class="vs">VS</span> ${match.awayTeam}</h2>
        <div class="details-box">${modelRows(match.prediction?.models)}</div>
      </div>
    `).join("");
  }

  if (activeTab === "api") {
    const sources = [...new Set(matches.map((match) => match.source || "unknown"))].join(", ");
    const warnings = [...new Set(matches.flatMap((match) => match.apiWarnings || []))];
    return `
      <div class="card">
        <h2>API статус</h2>
        <p>Источник: <b>${sources || "нет данных"}</b></p>
        <p>Матчей в выдаче: <b>${matches.length}</b></p>
        <p>Время: <b>как в BetUp — по времени телефона/браузера</b></p>
        ${warnings.length ? `<p class="red">${warnings.join("<br>")}</p>` : `<p class="green">Ошибок API не видно.</p>`}
      </div>
    `;
  }

  return matches.map((match) => renderMatch(match)).join("");
}

function renderTabs() {
  const tabs = [["top", "ТОП"], ["matches", "Матчи"], ["totals", "Тоталы"], ["value", "Value"], ["models", "Модели"], ["api", "API"]];
  return `<div class="tabs">${tabs.map(([id, label]) => `<button class="tab ${activeTab === id ? "active" : ""}" data-tab="${id}">${label}</button>`).join("")}</div>`;
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.tab;
      paint();
    });
  });
}

function paint() {
  const container = document.getElementById("matches");
  container.innerHTML = `${renderBestBets(cachedMatches)}${renderTabs()}${renderTab(cachedMatches)}`;
  bindTabs();
}

async function loadMatches(filter = "all") {
  const status = document.getElementById("status");
  const container = document.getElementById("matches");

  try {
    const response = await fetch(`/api/matches?filter=${filter}`);
    const data = await response.json();
    cachedMatches = data.matches || [];

    status.innerHTML = `
      <h2>Автомат работает</h2>
      <p>Матчей найдено: ${data.count}</p>
      <p class="small">Фильтр: сильные варианты от кэфа 1.40+. Время как в BetUp. Тоталы сетов 1/2/3 выведены в карточке.</p>
    `;

    if (!cachedMatches.length) {
      container.innerHTML = `<div class="card">Нет будущих матчей для показа.</div>`;
      return;
    }

    paint();
  } catch (error) {
    status.innerHTML = "Ошибка загрузки API";
    console.error(error);
  }
}

loadMatches();
