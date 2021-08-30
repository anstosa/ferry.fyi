import { Slot } from "shared/models/schedules";

export interface GetScheduleResponse {
  schedule: Slot[];
  timestamp: number;
}
