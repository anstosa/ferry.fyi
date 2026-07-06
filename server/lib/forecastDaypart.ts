import { DateTime } from "luxon";

export type ForecastDaypart =
  | "all"
  | "evening"
  | "midday"
  | "morning"
  | "overnight";

// slot daypart
export const getForecastDaypart = (time: DateTime): ForecastDaypart => {
  // overnight guard
  if (time.hour < 5) {
    return "overnight";
  }
  // morning guard
  if (time.hour < 11) {
    return "morning";
  }
  // midday guard
  if (time.hour < 16) {
    return "midday";
  }
  return "evening";
};
