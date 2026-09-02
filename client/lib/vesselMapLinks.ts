import type { Schedule, Slot } from "shared/contracts/schedules";

import { type DetailTab, getSailingDeepLink } from "./sailingDeepLink";

interface MapSailingPathInput {
  mapPathname: string;
  sailing: Slot;
  schedule: Schedule;
  tab: DetailTab;
}

// focused map path
export const getVesselMapPath = (
  schedulePathname: string,
  vesselId: string
): string => {
  const schedulePath = schedulePathname.replace(/\/+$/, "") || "/";
  const query = new URLSearchParams({ vessel: vesselId });
  return `${schedulePath === "/" ? "" : schedulePath}/map?${query.toString()}`;
};

// next assigned sailing
export const getNextVesselSailing = (
  schedule: Schedule | null | undefined,
  vesselId: string,
  nowSeconds: number
): Slot | null => {
  // missing schedule guard
  if (!schedule) {
    return null;
  }
  return (
    [...schedule.slots]
      .sort((left, right) => {
        // chronological sailing order
        return left.time - right.time;
      })
      .find((slot) => {
        // future vessel assignment
        return (
          slot.vessel.id === vesselId &&
          slot.time >= nowSeconds &&
          slot.crossing?.isCancelled !== true
        );
      }) ?? null
  );
};

// map-to-sailing path
export const getMapSailingPath = ({
  mapPathname,
  sailing,
  schedule,
  tab,
}: MapSailingPathInput): string => {
  const schedulePath = mapPathname.replace(/\/map\/?$/, "") || "/";
  const deepLink = new URL(
    getSailingDeepLink({
      currentUrl: new URL(schedulePath, "https://ferry.fyi").toString(),
      date: schedule.date,
      sailingTime: sailing.time,
      tab,
    })
  );
  return `${deepLink.pathname}${deepLink.search}`;
};
