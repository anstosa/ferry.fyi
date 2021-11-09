import { Schedule } from "shared/models/schedules";

export interface GetScheduleResponse {
  schedule: Schedule;
  timestamp: number;
}
