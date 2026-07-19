import type {
  FareLineItem,
  FareLineItemSelection,
} from "shared/contracts/fares";

export type FareTravelMode = "bicycle" | "vehicle" | "walk-on";
export type FareVehicleType =
  | "motorcycle"
  | "short"
  | "standard"
  | "tall-or-long";

export interface FareWizardConfig {
  adultPassengers: number;
  childPassengers: number;
  isSeniorOrDisabledDriver?: boolean;
  seniorPassengers: number;
  travelMode?: FareTravelMode;
  vehicleLength?: number;
  vehicleType?: FareVehicleType;
}

const DEFAULT_PASSENGER_COUNTS = {
  adultPassengers: 0,
  childPassengers: 0,
  seniorPassengers: 0,
} as const;

const isTravelMode = (value: string | null): value is FareTravelMode =>
  value === "bicycle" || value === "vehicle" || value === "walk-on";

const isVehicleType = (value: string | null): value is FareVehicleType =>
  value === "motorcycle" ||
  value === "short" ||
  value === "standard" ||
  value === "tall-or-long";

const readNonNegativeInteger = (
  value: string | null,
  fallback: number
): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const readVehicleLength = (value: string | null): number | undefined => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, 200)
    : undefined;
};

const readDriverEligibility = (value: string | null): boolean | undefined => {
  if (value === "senior") {
    return true;
  }
  if (value === "standard") {
    return false;
  }
  return undefined;
};

export const parseFareWizardConfig = (
  search: string | URLSearchParams
): FareWizardConfig => {
  const query =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const travelMode = query.get("fareMode");
  const vehicleType = query.get("fareVehicle");
  return {
    adultPassengers: readNonNegativeInteger(
      query.get("fareAdults"),
      DEFAULT_PASSENGER_COUNTS.adultPassengers
    ),
    childPassengers: readNonNegativeInteger(
      query.get("fareChildren"),
      DEFAULT_PASSENGER_COUNTS.childPassengers
    ),
    isSeniorOrDisabledDriver: readDriverEligibility(query.get("fareDriver")),
    seniorPassengers: readNonNegativeInteger(
      query.get("fareSeniors"),
      DEFAULT_PASSENGER_COUNTS.seniorPassengers
    ),
    travelMode: isTravelMode(travelMode) ? travelMode : undefined,
    vehicleLength: readVehicleLength(query.get("fareLength")),
    vehicleType: isVehicleType(vehicleType) ? vehicleType : undefined,
  };
};

/** Retain route/date query values while making a fare configuration shareable. */
export const withFareWizardConfig = (
  search: string,
  config: FareWizardConfig
): string => {
  const query = new URLSearchParams(search);
  const setOrDelete = (key: string, value: string | undefined): void => {
    if (value === undefined) {
      query.delete(key);
    } else {
      query.set(key, value);
    }
  };
  setOrDelete("fareMode", config.travelMode);
  let driverEligibility: string | undefined;
  if (config.isSeniorOrDisabledDriver === true) {
    driverEligibility = "senior";
  } else if (config.isSeniorOrDisabledDriver === false) {
    driverEligibility = "standard";
  }
  setOrDelete("fareDriver", driverEligibility);
  setOrDelete("fareVehicle", config.vehicleType);
  setOrDelete(
    "fareLength",
    config.vehicleLength === undefined
      ? undefined
      : String(config.vehicleLength)
  );
  query.set("fareAdults", String(config.adultPassengers));
  query.set("fareChildren", String(config.childPassengers));
  query.set("fareSeniors", String(config.seniorPassengers));
  return query.toString();
};

const findFare = (
  fares: FareLineItem[],
  label: RegExp
): FareLineItem | undefined => fares.find((fare) => label.test(fare.label));

const addFare = (
  selections: FareLineItemSelection[],
  fare: FareLineItem | undefined,
  quantity: number
): string | undefined => {
  if (!fare) {
    return "This fare configuration is not available for the selected route.";
  }
  if (quantity > 0) {
    selections.push({ fareLineItemId: fare.id, quantity });
  }
};

const driverFare = (
  fares: FareLineItem[],
  config: FareWizardConfig
): FareLineItem | undefined => {
  const seniorDriver = config.isSeniorOrDisabledDriver;
  if (config.vehicleType === "motorcycle") {
    return findFare(
      fares,
      seniorDriver
        ? /^Motorcycle.*(?:Senior|Disability)/i
        : /^Motorcycle.*Driver/i
    );
  }
  if (config.vehicleType === "short") {
    return seniorDriver
      ? findFare(fares, /^Vehicle U(?:nder)?14.*(?:Senior|Disability)/i)
      : findFare(fares, /^Vehicle Under 14.*Driver/i);
  }
  if (config.vehicleType === "standard") {
    return seniorDriver
      ? findFare(fares, /^Vehicle U(?:nder)?22.*(?:Senior|Disability)/i)
      : findFare(fares, /^Vehicle Under 22.*Driver/i);
  }
  return undefined;
};

const longVehicleFares = (
  fares: FareLineItem[],
  length: number
): FareLineItem[] | undefined => {
  let label: RegExp = /^Vehicle Under 80/i;
  if (length < 30) {
    label = /^Vehicle Under 30.*Over 7['’]2/i;
  } else if (length < 40) {
    label = /^Vehicle Under 40/i;
  } else if (length < 50) {
    label = /^Vehicle Under 50/i;
  } else if (length < 60) {
    label = /^Vehicle Under 60/i;
  } else if (length < 70) {
    label = /^Vehicle Under 70/i;
  }
  const baseFare = findFare(fares, label);
  if (!baseFare) {
    return;
  }
  if (length <= 80) {
    return [baseFare];
  }
  const perFootFare = findFare(fares, /^Cost per foot over 80/i);
  return perFootFare ? [baseFare, perFootFare] : undefined;
};

export type FareWizardSelectionResult =
  | { lineItems: FareLineItemSelection[]; ok: true }
  | { message: string; ok: false };

/** Match the user's travel choices to the official, route-specific fare catalog. */
export const createFareWizardSelections = (
  fares: FareLineItem[],
  config: FareWizardConfig
): FareWizardSelectionResult => {
  const selections: FareLineItemSelection[] = [];
  const add = (fare: FareLineItem | undefined, quantity: number): boolean => {
    const message = addFare(selections, fare, quantity);
    return !message;
  };
  const adultFare = findFare(fares, /^Adult\b/i);

  if (!config.travelMode) {
    return {
      message: "Choose how you are traveling to calculate a fare.",
      ok: false,
    };
  }

  if (config.travelMode === "walk-on") {
    return add(adultFare, 1)
      ? { lineItems: selections, ok: true }
      : {
          message: "Walk-on passenger fares are unavailable for this route.",
          ok: false,
        };
  }

  if (config.travelMode === "bicycle") {
    const bicycleFare = findFare(fares, /\bBicycle\b/i);
    return add(adultFare, 1) && add(bicycleFare, 1)
      ? { lineItems: selections, ok: true }
      : {
          message: "Bicycle fares are unavailable for this route.",
          ok: false,
        };
  }

  if (config.isSeniorOrDisabledDriver === undefined || !config.vehicleType) {
    return {
      message:
        "Choose the driver eligibility and vehicle type to calculate a fare.",
      ok: false,
    };
  }

  if (config.vehicleType === "tall-or-long") {
    if (config.vehicleLength === undefined) {
      return {
        message: "Choose the vehicle length to calculate a fare.",
        ok: false,
      };
    }
    const vehicleFares = longVehicleFares(fares, config.vehicleLength);
    if (!vehicleFares) {
      return {
        message: "This vehicle length is unavailable for the selected route.",
        ok: false,
      };
    }
    for (const fare of vehicleFares) {
      if (
        !add(
          fare,
          fare.label.startsWith("Cost") ? config.vehicleLength - 80 : 1
        )
      ) {
        return {
          message: "This vehicle length is unavailable for the selected route.",
          ok: false,
        };
      }
    }
  } else if (!add(driverFare(fares, config), 1)) {
    return {
      message: "This vehicle type is unavailable for the selected route.",
      ok: false,
    };
  }

  const passengerFares: Array<[FareLineItem | undefined, number]> = [
    [adultFare, config.adultPassengers],
    [findFare(fares, /^Youth\b/i), config.childPassengers],
    [findFare(fares, /^Senior\b/i), config.seniorPassengers],
  ];
  for (const [fare, quantity] of passengerFares) {
    if (quantity > 0 && !add(fare, quantity)) {
      return {
        message: "Passenger fares are unavailable for this route.",
        ok: false,
      };
    }
  }
  return { lineItems: selections, ok: true };
};
