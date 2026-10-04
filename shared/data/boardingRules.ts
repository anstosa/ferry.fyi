import type { TravelMode } from "shared/contracts/sailingRecommendations";
import ROUTES from "shared/data/route-terminal-ids.json";

export interface BoardingRule {
  advisorySeconds: number;
  cutoffSeconds: number;
  sourceUrl: string;
  verifiedAt: string;
}

const GENERAL_SOURCE =
  "https://wsdot.wa.gov/travel/washington-state-ferries/rider-information/first-time-riders";
const BICYCLE_SOURCE =
  "https://wsdot.wa.gov/travel/washington-state-ferries/rider-information/what-you-can-bring-aboard/bicycles";

// enumerate domestic directional pairs only
export const isRecommendationDirection = (
  departureId: string,
  arrivalId: string
): boolean =>
  departureId !== arrivalId &&
  Object.values(ROUTES).some(({ terminalIds }) => {
    // match one published route family
    return terminalIds.includes(departureId) && terminalIds.includes(arrivalId);
  });

// keep general planning advice separate from mandatory closure
export const getBoardingRule = (
  departureId: string,
  arrivalId: string,
  mode: TravelMode
): BoardingRule | null => {
  // reject international or unknown terminal pairs
  if (!isRecommendationDirection(departureId, arrivalId)) {
    return null;
  }
  return {
    advisorySeconds: mode === "drive" || mode === "bicycle" ? 1200 : 300,
    cutoffSeconds: 0,
    sourceUrl: mode === "bicycle" ? BICYCLE_SOURCE : GENERAL_SOURCE,
    verifiedAt: "2026-10-03",
  };
};
