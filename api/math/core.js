export function round(value, digits = 2) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function average(values) {
  const clean = values.map(Number).filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

export function impliedProbability(decimalOdd) {
  const odd = Number(decimalOdd || 0);
  if (odd <= 1) return 0;
  return 1 / odd;
}

export function logistic(x) {
  return 1 / (1 + Math.exp(-x));
}

export function valuePercent(modelProbability, decimalOdd) {
  return round((modelProbability - impliedProbability(decimalOdd)) * 100, 1);
}
