import { DateTime } from "luxon";

import {
  getSailingDayId,
  SAILING_DAY_BOUNDARY_HOUR,
  SAILING_DAY_ZONE,
} from "./ssrCachePolicy";

export { SAILING_DAY_BOUNDARY_HOUR, SAILING_DAY_ZONE };

const asPacific = (now: Date | DateTime): DateTime =>
  now instanceof Date ? DateTime.fromJSDate(now) : now;

/** The WSF service day begins at 03:00 local Pacific time. */
export const getSsrSailingDayId = (now: Date | DateTime): string =>
  getSailingDayId(asPacific(now));
