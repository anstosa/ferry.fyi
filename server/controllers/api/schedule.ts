import { Router } from "express";
import { DateTime } from "luxon";

import { updateEstimates } from "~/lib/forecast";
import { toWsfDate } from "~/lib/wsf/date";
import { updateSchedules } from "~/lib/wsf/updateSchedules";
import { Schedule } from "~/models/Schedule";

const scheduleRouter = Router();
const schedulePaths = [
  "/:departingId/:arrivingId",
  "/:departingId/:arrivingId/:date",
];

scheduleRouter.get(schedulePaths, async (request, response) => {
  const { departingId, arrivingId, date: dateInput } = request.params;
  const date = dateInput || toWsfDate();
  const today = DateTime.local().set({
    hour: 3,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  // past schedule guard
  if (DateTime.fromISO(date).set({ hour: 12 }) < today) {
    return response.status(404).send();
  }
  // cache fill guard
  if (!Schedule.hasFetchedDate(date)) {
    await updateSchedules(date);
    await updateEstimates();
  }
  const schedule = await Schedule.getByIndex(
    Schedule.generateKey(departingId, arrivingId, date)
  );
  // schedule found guard
  if (schedule) {
    return response.send({
      schedule: schedule.serialize(),
      timestamp: DateTime.local().toSeconds(),
    });
  } else {
    return response.status(404).send();
  }
});

export { scheduleRouter };
