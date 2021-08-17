import { DateTime } from "luxon";
import { isNull, round, toNumber } from "lodash";

export const wsfDateToTimestamp = (wsfDate?: string): number => {
  if (!wsfDate) {
    return 0;
  }
  const match = wsfDate.match(/\/Date\((\d+)-\d+\)\//);
  if (isNull(match) || !match[1]) {
    return 0;
  }
  return round(toNumber(match[1]) / 1000);
};

// "today" is a tricky concept. WSF's "day" ends around 3am
export const getToday = (): string => {
  let date = DateTime.local().setZone("America/Los_Angeles");
  if (date.hour < 3) {
    date = date.minus({ days: 1 });
  }
  return date.toFormat("yyyy-MM-dd");
};
