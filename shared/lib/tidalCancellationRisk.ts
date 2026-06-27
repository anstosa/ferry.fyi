import type { Slot } from "shared/contracts/schedules";

const VERY_LOW_TIDE_M = -0.6;
const FEET_PER_METER = 3.28084;
const INCHES_PER_FOOT = 12;

interface RiskRoute {
  routeLabel: string;
  signal: string;
}

export interface TidalCancellationRisk {
  explanation: string;
  tideLevelM: number | null;
  title: string;
}

interface GetTidalCancellationRiskInput {
  departureTerminalId: string;
  slot: Slot;
}

const TIDE_SENSITIVE_ROUTES: Record<string, RiskRoute> = {
  "1:10": {
    routeLabel: "Anacortes / Friday Harbor",
    signal: "low tides cluster with San Juan cancellation risk",
  },
  "1:13": {
    routeLabel: "Anacortes / Lopez Island",
    signal: "low tides have historically raised cancellation rates",
  },
  "1:15": {
    routeLabel: "Anacortes / Orcas Island",
    signal: "low tides have historically raised cancellation rates",
  },
  "1:18": {
    routeLabel: "Anacortes / Shaw Island",
    signal: "low tides have historically raised cancellation rates",
  },
  "10:1": {
    routeLabel: "Friday Harbor / Anacortes",
    signal: "low tides cluster with San Juan cancellation risk",
  },
  "11:17": {
    routeLabel: "Coupeville / Port Townsend",
    signal: "very low tides nearly doubled historical cancellation rates",
  },
  "13:1": {
    routeLabel: "Lopez Island / Anacortes",
    signal: "low tides cluster with San Juan cancellation risk",
  },
  "15:1": {
    routeLabel: "Orcas Island / Anacortes",
    signal: "low tides cluster with San Juan cancellation risk",
  },
  "17:11": {
    routeLabel: "Port Townsend / Coupeville",
    signal: "very low tides materially raised historical cancellation rates",
  },
  "18:1": {
    routeLabel: "Shaw Island / Anacortes",
    signal: "low tides cluster with San Juan cancellation risk",
  },
};

// format tide level
export const formatTideLevel = (waterLevelM: number): string =>
  `${waterLevelM.toFixed(2)}m MLLW`;

// format low tide offset
export const formatFeetBelowAverageLowTide = (waterLevelM: number): string => {
  const feet = Math.abs(waterLevelM * FEET_PER_METER);
  // inch display guard
  if (feet < 1) {
    return `${Math.round(feet * INCHES_PER_FOOT)}in`;
  }
  return `${feet.toFixed(1)}ft`;
};

// resolve lowest tide
export const getSlotLowestTideLevel = (slot: Slot): number | null => {
  // precomputed tide guard
  if (typeof slot.tide?.lowestWaterLevelM === "number") {
    return slot.tide.lowestWaterLevelM;
  }
  const levels = [slot.tide?.waterLevelM, slot.tide?.arrivalWaterLevelM].filter(
    (level): level is number => typeof level === "number"
  );
  // missing tide guard
  if (levels.length === 0) {
    return null;
  }
  return Math.min(...levels);
};

// get tidal cancellation risk
export const getTidalCancellationRisk = ({
  departureTerminalId,
  slot,
}: GetTidalCancellationRiskInput): TidalCancellationRisk | null => {
  const route = TIDE_SENSITIVE_ROUTES[`${departureTerminalId}:${slot.mateId}`];
  // insensitive route guard
  if (!route) {
    return null;
  }
  const tideLevelM = getSlotLowestTideLevel(slot);
  const isConfirmedTidalCancellation =
    slot.crossing?.isCancelled && slot.cancellationReason === "tidal";
  // confirmed tidal cancellation
  if (isConfirmedTidalCancellation) {
    const tideVerb = slot.hasPassed ? "tide was" : "tide forecast is";
    return {
      explanation:
        tideLevelM === null
          ? "This sailing is confirmed cancelled due to tidal conditions."
          : `WSF has cancelled this sailing due to tidal conditions; ` +
            `${tideVerb} ${formatFeetBelowAverageLowTide(
              tideLevelM
            )} below the average low tide.`,
      tideLevelM,
      title: "Tidal cancellation",
    };
  }
  // confirmed cancellation guard
  if (slot.crossing?.isCancelled) {
    return {
      explanation:
        "WSF has cancelled this sailing for a reason other than tidal " +
        "conditions. See route alerts for more.",
      tideLevelM,
      title: "Sailing Cancelled",
    };
  }
  // past sailing guard
  if (slot.hasPassed) {
    return null;
  }
  // missing tide guard
  if (tideLevelM === null) {
    return null;
  }
  // threshold guard
  if (tideLevelM >= VERY_LOW_TIDE_M) {
    return null;
  }
  return {
    explanation:
      "This sailing is likely to be cancelled; tide forecast is " +
      `${formatFeetBelowAverageLowTide(tideLevelM)} below the average low tide. ` +
      "WSF typically cancels for low tides at that level on this route.",
    tideLevelM,
    title: "Tidal cancellation risk",
  };
};
