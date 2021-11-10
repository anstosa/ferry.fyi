import { CacheableModel } from "./CacheableModel";
import { entries } from "shared/lib/objects";
import { keyBy } from "shared/lib/arrays";
import { Schedule as ScheduleClass, Slot } from "shared/contracts/schedules";
import Crossing from "~/models/Crossing";

interface ServerSlot extends Slot {
  crossing?: Crossing;
}
export class Schedule extends CacheableModel implements ScheduleClass {
  static cacheKey = "schedules";
  static index = "key";

  date!: string;
  key!: string;
  mateId!: string;
  slots!: ServerSlot[];
  terminalId!: string;

  static generateKey(
    departureId: string,
    arrivalId: string,
    date: string
  ): string {
    return `${departureId}-${arrivalId}-${date}`;
  }

  static getByDate(date: string): Record<string, Schedule> {
    const schedules = this.getAll();
    const filteredSchedules = entries(schedules)
      .map(([, schedule]) => schedule)
      .filter((schedule) => schedule.date === date);
    return keyBy(filteredSchedules, "key");
  }

  getSlot = (departureTime: number): ServerSlot | null => {
    const slot = this.slots.find(({ time }) => time === departureTime);
    return slot || null;
  };

  serialize(): ScheduleClass {
    return CacheableModel.serialize({
      date: this.date,
      key: this.key,
      mateId: this.mateId,
      slots: this.slots,
      terminalId: this.terminalId,
    });
  }
}
