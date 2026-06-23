import { DateTime } from "luxon";

// require iso date
export const toRequiredISODate = (date: DateTime): string => {
  const isoDate = date.toISODate();
  // invalid date guard
  if (!isoDate) {
    throw new Error("Invalid weather date");
  }
  return isoDate;
};
