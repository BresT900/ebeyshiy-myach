const MOSCOW_TIMEZONE = "Europe/Moscow";

function formatRussianDateTime(match) {
  const rawDate = match.date || "";
  const rawTime = match.time || "";
  const source = `${rawDate}T${rawTime || "00:00"}:00Z`;
  const parsed = new Date(source);

  if (Number.isNaN(parsed.getTime())) {
    return {
      date: rawDate || "дата не указана",
      time: rawTime || "время не указано"
    };
  }

  return {
    date: parsed.toLocaleDateString("ru-RU", {
      timeZone: MOSCOW_TIMEZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }),
    time: parsed.toLocaleTimeString("ru-RU", {
      timeZone: MOSCOW_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit"
    })
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

function renderMatch(match) {
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
        <span>${dt.time} МСК</span>
        <span>${dt.date}</span>
      </div>

      <div class="pick">
        <b>Главный выбор:</b><br>
        ${best.selection || "Расчёт..."}<br>
        <span class="green">${best.probability || "0"}% уверенности</span>
        <div class="meta-line">Кэф: ${formatOdd(best.odd)} • Value: ${formatNumber(best.valuePercent)}% • Риск: ${best.risk || "—"}/10 (${best.riskLabel || "—"})</div>
      </div>

      <div class="grid">
        <div class="mini-card">
          <span>Тотал матча</span>
          <b>${formatNumber(totals.projectedMatchTotal)}</b>
          <small>Линия: ${formatNumber(totals.matchLine, "нет линии")}</small>
        </div>
        <div class="mini-card">
          <span>Тотал ${match.homeTeam}</span>
          <b>${formatNumber(totals.projectedHomeTotal)}</b>
          <small>Линия: ${formatNumber(totals.homeTotalLine, "нет линии")}</small>
        </div>
        <div class="mini-card">
          <span>Тотал ${match.awayTeam}</span>
          <b>${formatNumber(totals.projectedAwayTotal)}</b>
          <small>Линия: ${formatNumber(totals.awayTotalLine, "нет линии")}</small>
        </div>
        <div class="mini-card">
          <span>Poisson</span>
          <b>ТБ ${formatNumber(model.overProbability)}%</b>
          <small>ТМ ${formatNumber(model.underProbability)}%</small>
        </div>
      </div>

      <details>
        <summary>Модель и причины</summary>
        <div class="details-box">
          <p><b>${model.name || "Модель"}</b></p>
          ${(prediction.reasons || []).map((reason) => `<p>• ${reason}</p>`).join("")}
        </div>
      </details>
    </div>
  `;
}

async function loadMatches(filter = "all") {
  const status = document.getElementById("status");
  const container = document.getElementById("matches");

  try {
    const response = await fetch(`/api/matches?filter=${filter}`);
    const data = await response.json();

    status.innerHTML = `
      <h2>Автомат работает</h2>
      <p>Матчей найдено: ${data.count}</p>
      <p class="small">Время показано по Москве. Сыгранные матчи скрываются сервером.</p>
    `;

    container.innerHTML = data.matches.length
      ? data.matches.map(renderMatch).join("")
      : `<div class="card">Нет будущих матчей для показа.</div>`;
  } catch (error) {
    status.innerHTML = "Ошибка загрузки API";
    console.error(error);
  }
}

loadMatches();
