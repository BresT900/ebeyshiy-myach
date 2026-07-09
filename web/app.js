const MOSCOW_TIMEZONE = "Europe/Moscow";
let cachedMatches = [];
let activeTab = "matches";

function formatRussianDateTime(match) {
  if (match.moscowTime) {
    return {
      date: match.moscowTime.date || match.date || "дата не указана",
      time: match.moscowTime.time || match.time || "время не указано",
      label: match.moscowTime.label || match.moscowTime.date || ""
    };
  }

  const rawDate = match.date || "";
  const rawTime = match.time || "";
  const source = `${rawDate}T${rawTime || "00:00"}:00Z`;
  const parsed = new Date(source);

  if (Number.isNaN(parsed.getTime())) {
    return { date: rawDate || "дата не указана", time: rawTime || "время не указано", label: rawDate || "" };
  }

  return {
    date: parsed.toLocaleDateString("ru-RU", { timeZone: MOSCOW_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" }),
    time: parsed.toLocaleTimeString("ru-RU", { timeZone: MOSCOW_TIMEZONE, hour: "2-digit", minute: "2-digit" }),
    label: parsed.toLocaleDateString("ru-RU", { timeZone: MOSCOW_TIMEZONE, day: "2-digit", month: "2-digit" })
  };
}

function formatNumber(value, fallback = "—") {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : fallback;
}

function formatOdd(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number.toFixed(2) : "нет";
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
  if (!rows.length) return `<div class="muted">Value пока не найден.</div>`;

  return rows.slice(0, 4).map((row) => `
    <div class="value-row">
      <div>
        <b>${row.selection}</b>
        <span>${row.type} • кэф ${formatOdd(row.odd)}</span>
      </div>
      <strong class="${Number(row.valuePercent) >= 0 ? "green" : "red"}">${formatNumber(row.valuePercent)}%</strong>
    </div>
  `).join("");
}

function renderMatch(match, compact = false) {
  const prediction = match.prediction || {};
  const best = prediction.bestPick || {};
  const totals = prediction.totals || {};
  const model = prediction.model || {};
  const dt = formatRussianDateTime(match);

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
        <span>${dt.label ? `${dt.label} • ` : ""}${dt.time} МСК</span>
        <span>${dt.date}</span>
      </div>

      <div class="pick">
        <b>Главный выбор:</b><br>
        ${best.selection || "Расчёт..."}<br>
        <span class="green">${best.probability || "0"}% уверенности</span>
        <div class="meta-line">Кэф: ${formatOdd(best.odd)} • Value: ${formatNumber(best.valuePercent)}% • Риск: ${best.risk || "—"}/10 (${best.riskLabel || "—"})</div>
      </div>

      <div class="grid">
        <div class="mini-card"><span>Тотал матча</span><b>${formatNumber(totals.projectedMatchTotal)}</b><small>Линия: ${formatNumber(totals.matchLine, "нет линии")}</small></div>
        <div class="mini-card"><span>Тотал 1</span><b>${formatNumber(totals.projectedHomeTotal)}</b><small>${match.homeTeam}</small></div>
        <div class="mini-card"><span>Тотал 2</span><b>${formatNumber(totals.projectedAwayTotal)}</b><small>${match.awayTeam}</small></div>
        <div class="mini-card"><span>Ensemble</span><b>ТБ ${formatNumber(model.overProbability)}%</b><small>ТМ ${formatNumber(model.underProbability)}%</small></div>
      </div>

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

function renderBestBets(matches) {
  const best = [...matches]
    .filter((match) => Number(match.prediction?.bestPick?.valuePercent) >= 0)
    .sort((a, b) => {
      const av = Number(a.prediction?.bestPick?.valuePercent || 0) - Number(a.prediction?.bestPick?.risk || 10) * 0.45;
      const bv = Number(b.prediction?.bestPick?.valuePercent || 0) - Number(b.prediction?.bestPick?.risk || 10) * 0.45;
      return bv - av;
    })
    .slice(0, 3);

  if (!best.length) return "";

  return `
    <section class="card best-block">
      <h2>Лучшие ставки дня</h2>
      ${best.map((match, index) => {
        const pick = match.prediction.bestPick;
        const dt = formatRussianDateTime(match);
        return `
          <div class="best-row">
            <div class="rank">#${index + 1}</div>
            <div>
              <b>${pick.selection}</b>
              <span>${match.homeTeam} — ${match.awayTeam}</span>
              <small>${dt.label ? `${dt.label}, ` : ""}${dt.time} МСК • кэф ${formatOdd(pick.odd)} • value ${formatNumber(pick.valuePercent)}%</small>
            </div>
          </div>
        `;
      }).join("")}
    </section>
  `;
}

function renderTab(matches) {
  if (activeTab === "value") {
    const valueMatches = matches.filter((match) => Number(match.prediction?.bestPick?.valuePercent) >= 0);
    return valueMatches.length ? valueMatches.map((match) => renderMatch(match)).join("") : `<div class="card">Валуйных вариантов пока нет.</div>`;
  }

  if (activeTab === "totals") {
    return matches.map((match) => renderMatch(match, false)).join("");
  }

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
        <p>Время: <b>Москва / МСК</b></p>
        ${warnings.length ? `<p class="red">${warnings.join("<br>")}</p>` : `<p class="green">Ошибок API не видно.</p>`}
      </div>
    `;
  }

  return matches.map((match) => renderMatch(match)).join("");
}

function renderTabs() {
  const tabs = [
    ["matches", "Матчи"],
    ["totals", "Тоталы"],
    ["value", "Value"],
    ["models", "Модели"],
    ["api", "API"]
  ];

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
      <p class="small">Время как в ставочных приложениях: Сегодня / Завтра / дата + МСК. Сыгранные матчи скрываются сервером.</p>
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
