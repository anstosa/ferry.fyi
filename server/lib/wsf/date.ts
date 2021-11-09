import { DateTime } from "luxon";
import { isNull } from "shared/lib/identity";
import { round } from "shared/lib/math";

/**
 * WSF datetime stamps are in the format "\/Date(1629413100000-0700)\/"
 * 1. Yes, that's a string literal "\/"
 * 2. Yes, the timezone is included even though all times are obviously Pacific
 * 3. Yes, the timestamp is in milliseconds
 **/
export const wsfDateToTimestamp = (wsfDate?: string): number => {
  // Return a date even if we weren't given one
  if (!wsfDate) {
    return 0;
  }

  const match = wsfDate.match(/\/Date\((\d+)-\d+\)\//);

  // Return a date even if we were passed something weird
  if (isNull(match) || !match[1]) {
    return 0;
  }

  return round(Number(match[1]) / 1000);
};

/**
 * "today" is a tricky concept.
 * WSF's "day" ends around 3am the following morning
 **/
export const toWsfDate = (input?: number | DateTime): string => {
  let date;
  if (input) {
    date = typeof input === "number" ? DateTime.fromSeconds(input) : input;
  } else {
    date = DateTime.local();
  }
  date.setZone("America/Los_Angeles");
  if (date.hour < 3) {
    date = date.minus({ days: 1 });
  }
  return date.toFormat("yyyy-MM-dd");
};
