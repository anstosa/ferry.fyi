import { isNil } from "shared/lib/identity";

export const FULL_CAPACITY_THRESHOLD = 90;

interface CapacityFullOptions {
  percentFull?: number | null;
  spacesLeft?: number | null;
}

// classify full capacity
export const isCapacityFull = ({
  percentFull,
  spacesLeft,
}: CapacityFullOptions): boolean => {
  // explicit full
  if (!isNil(spacesLeft) && spacesLeft <= 0) {
    return true;
  }

  // practical full
  if (!isNil(percentFull) && percentFull > FULL_CAPACITY_THRESHOLD) {
    return true;
  }

  return false;
};

interface CapacityDisplayPercentOptions {
  isFull: boolean;
  percentFull?: number | null;
}

interface CapacityUsageOptions {
  driveUpCapacity?: number | null;
  reservableCapacity?: number | null;
  totalCapacity?: number | null;
}

export interface CapacityUsage {
  percentFull: number | null;
  spacesLeft: number | null;
}

interface VesselVehicleCapacityOptions {
  tallVehicleCapacity?: number | null;
  vehicleCapacity?: number | null;
}

// calculate one capacity snapshot
export const getCapacityUsage = ({
  driveUpCapacity,
  reservableCapacity,
  totalCapacity,
}: CapacityUsageOptions): CapacityUsage => {
  // require a finite primary count
  if (
    typeof driveUpCapacity !== "number" ||
    !Number.isFinite(driveUpCapacity)
  ) {
    return { percentFull: null, spacesLeft: null };
  }
  const validReservableCapacity =
    typeof reservableCapacity === "number" &&
    Number.isFinite(reservableCapacity)
      ? reservableCapacity
      : 0;
  const spacesLeft = driveUpCapacity + validReservableCapacity;
  const hasValidTotalCapacity =
    typeof totalCapacity === "number" &&
    Number.isFinite(totalCapacity) &&
    totalCapacity > 0;
  // normalize the display range
  const percentFull = hasValidTotalCapacity
    ? Math.min(
        100,
        Math.max(0, ((totalCapacity - spacesLeft) / totalCapacity) * 100)
      )
    : null;
  return { percentFull, spacesLeft };
};

// calculate usable vehicle capacity
export const getVesselVehicleCapacity = ({
  tallVehicleCapacity,
  vehicleCapacity,
}: VesselVehicleCapacityOptions): number => {
  const validVehicleCapacity =
    typeof vehicleCapacity === "number" && Number.isFinite(vehicleCapacity)
      ? vehicleCapacity
      : 0;
  const validTallVehicleCapacity =
    typeof tallVehicleCapacity === "number" &&
    Number.isFinite(tallVehicleCapacity)
      ? tallVehicleCapacity
      : 0;
  return Math.max(0, validVehicleCapacity - validTallVehicleCapacity);
};

// choose display percent
export const getCapacityDisplayPercent = ({
  isFull,
  percentFull,
}: CapacityDisplayPercentOptions): number => {
  // full display
  if (isFull) {
    return 100;
  }

  return percentFull ?? 0;
};
