async function loadMatches() {
  const status = document.getElementById("status");
  const container = document.getElementById("matches");

  try {
    const response = await fetch("/api/matches");
    const data = await response.json();

    status.innerHTML = `
      <h2>Автомат работает</h2>
      <p>Матчей найдено: ${data.count}</p>
    `;

    container.innerHTML = data.matches.map((match) => `
      <div class="match">
        <div class="small">${match.league || "Волейбол"}</div>
        <h2>${match.homeTeam} 🆚 ${match.awayTeam}</h2>
        <div class="teams">
          <span>${match.time || ""}</span>
          <span>${match.date || ""}</span>
        </div>
        <div class="pick">
          <b>Главный выбор:</b><br>
          ${match.prediction?.bestPick?.selection || "Расчёт..."}<br>
          <span class="green">
            ${match.prediction?.bestPick?.probability || "0"}% уверенности
          </span>
        </div>
      </div>
    `).join("");

  } catch (error) {
    status.innerHTML = "Ошибка загрузки API";
    console.error(error);
  }
}

loadMatches();
