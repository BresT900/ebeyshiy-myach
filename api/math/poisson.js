import { clamp, round } from "./core.js";

function poissonProbability(lambda, k) {
  if (lambda <= 0 || k < 0) return 0;
  let factorial = 1;
  for (let i = 2; i <= k; i += 1) factorial *= i;
  return (Math.exp(-lambda) * lambda ** k) / factorial;
}

export function poissonOverUnder({ projectedTotal, line, spread = 12 }) {
  const safeProjected = Math.max(1, Number(projectedTotal || 0));
  const safeLine = Number(line || safeProjected);
  const normalizedLambda = Math.max(1, safeProjected / spread);
  const normalizedLine = Math.max(0, Math.floor(safeLine / spread));

  let under = 0;
  for (let k = 0; k <= normalizedLine; k += 1) {
    under += poissonProbability(normalizedLambda, k);
  }

  const over = 1 - under;

  return {
    model: "POISSON_TOTALS",
    projectedTotal: round(safeProjected, 1),
    line: safeLine,
    overProbability: round(clamp(over, 0.05, 0.95), 4),
    underProbability: round(clamp(under, 0.05, 0.95), 4),
    edge: round(safeProjected - safeLine, 1)
  };
}
