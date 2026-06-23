interface ShouldUseForecastCapacityStatusOptions {
  hasDeparted: boolean;
  hasForecastCapacity: boolean;
  hasLiveCapacity: boolean;
  isLiveCapacityEmpty: boolean;
}

// choose forecast status source
export const shouldUseForecastCapacityStatus = ({
  hasDeparted,
  hasForecastCapacity,
  hasLiveCapacity,
  isLiveCapacityEmpty,
}: ShouldUseForecastCapacityStatusOptions): boolean =>
  !hasDeparted &&
  hasForecastCapacity &&
  (!hasLiveCapacity || isLiveCapacityEmpty);
