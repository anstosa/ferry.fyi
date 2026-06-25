const SMALL_BOAT_CAPACITY_RATIO = 0.9;

// compare vessel size
export const isSmallBoatCapacity = (
  vehicleCapacity: number | undefined,
  routeMaxVehicleCapacity: number | undefined
): boolean => {
  // missing capacity guard
  if (!vehicleCapacity || !routeMaxVehicleCapacity) {
    return false;
  }
  return vehicleCapacity < routeMaxVehicleCapacity * SMALL_BOAT_CAPACITY_RATIO;
};

// find scheduled maximum
export const getCurrentRouteMaxVehicleCapacity = (
  capacities: Array<number | undefined>
): number | undefined => {
  const knownCapacities = capacities.filter((capacity): capacity is number => {
    // known capacity guard
    return Boolean(capacity);
  });
  // missing scheduled capacities
  if (knownCapacities.length === 0) {
    return undefined;
  }
  return Math.max(...knownCapacities);
};

// prefer largest route baseline
export const getRouteMaxVehicleCapacity = (
  scheduledMaxCapacity: number | undefined,
  normalMaxCapacity: number | undefined
): number | undefined => {
  const knownCapacities = [scheduledMaxCapacity, normalMaxCapacity].filter(
    (capacity): capacity is number => {
      // known capacity guard
      return Boolean(capacity);
    }
  );
  // missing route baseline
  if (knownCapacities.length === 0) {
    return undefined;
  }
  return Math.max(...knownCapacities);
};
