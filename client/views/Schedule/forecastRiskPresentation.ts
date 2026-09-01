import type { ForecastFullRisk } from "shared/contracts/schedules";

interface ForecastRiskPresentationInput {
  fullProbability?: number;
  fullRisk: ForecastFullRisk;
  isPracticalFull: boolean;
}

export interface ForecastRiskPresentation {
  compactText: string | null;
  detail: string;
  heading: string;
  label: string;
  tone: ForecastFullRisk;
}

const COMPACT_RISK_LABELS: Record<ForecastFullRisk, string | null> = {
  high: "High full risk",
  likely: "Likely full",
  low: null,
  unlikely: "Unlikely full",
};

// identify categorical full forecasts
export const isForecastExpectedFull = (
  fullRisk: ForecastFullRisk | undefined
): boolean => fullRisk === "likely" || fullRisk === "high";

// build point-aware risk copy
export const getForecastRiskPresentation = ({
  fullProbability,
  fullRisk,
  isPracticalFull,
}: ForecastRiskPresentationInput): ForecastRiskPresentation => {
  const hasProbability =
    typeof fullProbability === "number" && Number.isFinite(fullProbability);
  const riskPercent = hasProbability ? Math.round(fullProbability * 100) : null;
  const riskSuffix = riskPercent === null ? "" : ` · ${riskPercent}% full risk`;
  // practical-full point warning
  if (isPracticalFull && !isForecastExpectedFull(fullRisk)) {
    return {
      compactText: `Near capacity${riskSuffix}`,
      detail:
        riskPercent === null
          ? "Very few vehicle spaces are forecast to remain"
          : `${riskPercent}% chance of filling completely`,
      heading: "Capacity warning",
      label: "Near capacity",
      tone: "likely",
    };
  }
  const compactLabel = COMPACT_RISK_LABELS[fullRisk];
  return {
    compactText: compactLabel ? `${compactLabel}${riskSuffix}` : null,
    detail:
      riskPercent === null
        ? "Full-sailing likelihood unavailable"
        : `${riskPercent}% likelihood`,
    heading: "Full sailing risk",
    label: fullRisk,
    tone: fullRisk,
  };
};
