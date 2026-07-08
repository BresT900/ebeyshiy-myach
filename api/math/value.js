import { impliedProbability, round } from "./core.js";

export function calculateValue({ probability, odd, minOdd = 1.4 }) {
  const modelProbability = Number(probability || 0);
  const decimalOdd = Number(odd || 0);
  const implied = impliedProbability(decimalOdd);
  const edge = modelProbability - implied;
  const valuePercent = edge * 100;

  return {
    model: "VALUE",
    odd: decimalOdd,
    modelProbability: round(modelProbability, 4),
    impliedProbability: round(implied, 4),
    edge: round(edge, 4),
    valuePercent: round(valuePercent, 1),
    hasValue: decimalOdd >= minOdd && edge >= 0.03,
    grade: gradeValue(valuePercent, decimalOdd, minOdd)
  };
}

function gradeValue(valuePercent, odd, minOdd) {
  if (odd < minOdd) return "NO_BET_LOW_ODD";
  if (valuePercent >= 8) return "STRONG_VALUE";
  if (valuePercent >= 5) return "GOOD_VALUE";
  if (valuePercent >= 3) return "SMALL_VALUE";
  return "NO_VALUE";
}
