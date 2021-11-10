import { Schedule } from "shared/contracts/schedules";

export interface GetScheduleResponse {
  schedule: Schedule;
  timestamp: number;
}
