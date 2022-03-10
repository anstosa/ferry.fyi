import { DateTime } from "luxon";
import { Router } from "express";
import { Schedule } from "~/models/Schedule";
import { toWsfDate } from "~/lib/wsf/date";
import { updateEstimates } from "~/lib/forecast";
import { updateSchedules } from "~/lib/wsf/updateSchedules";

const scheduleRouter = Router();

scheduleRouter.get(
  "/:departingId/:arrivingId/:date?",
  async (request, response) => {
    const { departingId, arrivingId, date: dateInput } = request.params;
    const date = dateInput || toWsfDate();
    const today = DateTime.local().set({
      hour: 3,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
    if (DateTime.fromISO(date).set({ hour: 12 }) < today) {
      return response.status(404).send();
    }
    if (!Schedule.hasFetchedDate(date)) {
      await updateSchedules(date);
      await updateEstimates();
    }
    const schedule = await Schedule.getByIndex(
      Schedule.generateKey(departingId, arrivingId, date)
    );
    if (schedule) {
      return response.send({
        schedule: schedule.serialize(),
        timestamp: DateTime.local().toSeconds(),
      });
    } else {
      return response.status(404).send();
    }
  }
);

export { scheduleRouter };
