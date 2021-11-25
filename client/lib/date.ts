import { DateTime } from "luxon";

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
