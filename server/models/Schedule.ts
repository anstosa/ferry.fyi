import { CacheableModel } from "./CacheableModel";
import { Schedule as ScheduleClass, Slot } from "shared/models/schedules";

export class Schedule extends CacheableModel implements ScheduleClass {
  static cacheKey = "schedules";
  static index = "key";

  date!: string;
  key!: string;
  slots!: Slot[];
  terminalId!: string;

  static generateKey(terminalId: string, date: string): string {
    return `${terminalId}-${date}`;
  }

  serialize = (): ScheduleClass => ({
    date: this.date,
    key: this.key,
    slots: this.slots,
    terminalId: this.terminalId,
  });
}
