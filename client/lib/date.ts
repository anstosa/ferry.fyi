import { DateTime } from "luxon";

export const toAddedDateString = (
  date: DateTime,
  now = DateTime.local()
): string => {
  const addedDay = date.startOf("day");
  const today = now.startOf("day");

  if (addedDay.hasSame(today, "day")) {
    return "today";
  }
  if (addedDay.hasSame(today.minus({ day: 1 }), "day")) {
    return "yesterday";
  }
  return date.year === now.year
    ? date.toFormat("MMM d")
    : date.toFormat("MMM d, yyyy");
};

export const toShortDateString = (date: DateTime): string => {
  const formattedDate = [date.toFormat("ccc")];
  const today = DateTime.local();

  if (date.month !== today.month) {
    formattedDate.push(date.toFormat("MMM"));
  }

  formattedDate.push(date.toFormat("d"));

  if (date.year !== today.year) {
    formattedDate.push(date.toFormat("y"));
  }

  return formattedDate.join(" ");
};

export const isWSFToday = (date: DateTime): boolean => {
  const today_start = DateTime.local()
    .set({
      hour: 3,
      minute: 0,
      second: 0,
      millisecond: 0,
    })
    .plus({ day: 1 });
  const today_end = today_start.plus({ day: 1 });
  return today_start <= date && date < today_end;
};
