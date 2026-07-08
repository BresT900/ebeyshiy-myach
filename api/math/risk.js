import { clamp, round } from "./core.js";

export function calculateRisk({ probability = 0.5, sampleSize = 0, agreement = 0, valuePercent = 0 }) {
  const confidenceRisk = (1 - probability) * 5;
  const sampleRisk = sampleSize < 5 ? 2 : sampleSize < 10 ? 1 : 0.3;
  const disagreementRisk = (1 - clamp(agreement / 10, 0, 1)) * 2;
  const valueRisk = valuePercent < 3 ? 1 : 0;

  const score = clamp(
    confidenceRisk + sampleRisk + disagreementRisk + valueRisk,
    1,
    10
  );

  return {
    model: "RISK",
    score: round(score, 1),
    level: score <= 3 ? "LOW" : score <= 6 ? "MEDIUM" : "HIGH"
  };
}
