export const ON_TIME_DELAY_THRESHOLD_MINS = 3;

// summary late threshold
export const isLateForSummary = (delayMins: number): boolean =>
  Math.round(delayMins) > ON_TIME_DELAY_THRESHOLD_MINS;
