import { DateTime } from "luxon";

import type { PublicSsrRouteDefinition } from "../contracts/ssrRouting";

export interface NormalizedPublicQuery {
  rejected: readonly string[];
  values: Readonly<Record<string, string>>;
}
const isDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  DateTime.fromISO(value, { zone: "utc" }).isValid;
const isFare = (name: string, value: string) =>
  (name === "fareMode" && ["bicycle", "vehicle", "walk-on"].includes(value)) ||
  (name === "fareVehicle" &&
    ["motorcycle", "short", "standard", "tall-or-long"].includes(value)) ||
  (name === "fareDriver" && ["senior", "standard"].includes(value)) ||
  (name === "fareLength" &&
    /^\d+$/.test(value) &&
    Number(value) > 0 &&
    Number(value) <= 200) ||
  (["fareAdults", "fareChildren", "fareSeniors"].includes(name) &&
    /^\d+$/.test(value) &&
    Number(value) <= 99);
export const normalizePublicQuery = (
  route: Pick<PublicSsrRouteDefinition, "allowedQuery">,
  search: URLSearchParams
): NormalizedPublicQuery => {
  const values: Record<string, string> = {};
  const rejected: string[] = [];
  for (const name of route.allowedQuery) {
    const all = search.getAll(name);
    const value = all[0];
    if (
      all.length !== 1 ||
      !value ||
      value.length > 32 ||
      (name === "date" ? !isDate(value) : !isFare(name, value))
    ) {
      if (all.length) {
        rejected.push(name);
      }
      continue;
    }
    values[name] = [
      "fareAdults",
      "fareChildren",
      "fareSeniors",
      "fareLength",
    ].includes(name)
      ? String(Number(value))
      : value;
  }
  return { rejected, values };
};
export const publicQueryCacheKey = ({ values }: NormalizedPublicQuery) =>
  Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
