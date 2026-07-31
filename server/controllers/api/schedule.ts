import { Router } from "express";

import { toWsfDate } from "~/lib/wsf/date";
import {
  getCachedPublicSchedule,
  getPublicSchedule,
} from "~/services/public/schedules";

const scheduleRouter = Router();
const schedulePaths = [
  "/:departingId/:arrivingId",
  "/:departingId/:arrivingId/:date",
];

scheduleRouter.get(schedulePaths, async (request, response) => {
  const { departingId, arrivingId, date: dateInput } = request.params;
  const date = dateInput || toWsfDate();
  const result = await getPublicSchedule({ arrivingId, date, departingId });
  if (result.status === "available") {
    return response.send({
      schedule: result.schedule,
      timestamp: result.timestamp,
    });
  }
  if (result.status === "refreshing" || result.status === "warming") {
    return response.status(503).send({ status: result.status });
  }
  return response.status(404).send();
});

// Read-only manual refresh: it returns the cached schedule and deliberately
// never starts schedule, estimate, forecast, or WSF recalculation work.
scheduleRouter.post(schedulePaths, (request, response) => {
  const { departingId, arrivingId, date: dateInput } = request.params;
  const date = dateInput || toWsfDate();
  const result = getCachedPublicSchedule({ arrivingId, date, departingId });
  if (result.status !== "available") {
    return response.status(404).send();
  }
  return response.send({
    schedule: result.schedule,
    timestamp: result.timestamp,
  });
});

export { scheduleRouter };
