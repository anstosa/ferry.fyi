import { DemandEvent, type DemandEventType } from "~/models/DemandEvent";

export interface DemandEventInput {
  endsAt: number;
  eventType: DemandEventType;
  location: string;
  pressure: number;
  source: string;
  sourceId: string;
  startsAt: number;
  title: string;
}

// event persistence
export const persistDemandEvents = async (
  events: DemandEventInput[]
): Promise<void> => {
  // event loop
  for (const event of events) {
    const existingEvent = await DemandEvent.findOne({
      where: {
        source: event.source,
        sourceId: event.sourceId,
      },
    });
    // existing event guard
    if (existingEvent) {
      await existingEvent.update(event);
    } else {
      await DemandEvent.create({ ...event });
    }
  }
};
