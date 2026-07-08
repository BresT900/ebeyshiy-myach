import { clamp, round } from "./core.js";

export function eloWinProbability(homeRating = 1500, awayRating = 1500, homeAdvantage = 35) {
  const adjustedHome = Number(homeRating || 1500) + Number(homeAdvantage || 0);
  const adjustedAway = Number(awayRating || 1500);
  const probability = 1 / (1 + 10 ** ((adjustedAway - adjustedHome) / 400));

  return {
    home: round(clamp(probability, 0.05, 0.95), 4),
    away: round(clamp(1 - probability, 0.05, 0.95), 4),
    diff: round(adjustedHome - adjustedAway, 1)
  };
}

export function eloSignal(homeRating, awayRating) {
  const p = eloWinProbability(homeRating, awayRating);
  const favorite = p.home >= p.away ? "home" : "away";
  const probability = Math.max(p.home, p.away);

  return {
    model: "ELO",
    favorite,
    probability: round(probability, 4),
    strength: round(Math.abs(probability - 0.5) * 2, 4),
    details: p
  };
}
