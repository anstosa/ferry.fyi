import { Message } from "firebase-admin/messaging";
import { values } from "shared/lib/objects";
import { getProjectedTiming } from "shared/lib/projectedTiming";

import { sendPush } from "~/lib/push";
import { getSubscribedTerminalPushMessages } from "~/lib/pushSubscriptions";
import { Schedule } from "~/models/Schedule";
import { Terminal } from "~/models/Terminal";

const DELAY_THRESHOLDS = [15, 30, 45, 60];
const ON_SCHEDULE_THRESHOLD = 15;

interface DelayCandidate {
  delayMins: number;
  key: string;
  mateId: string;
  terminalId: string;
  vesselName: string;
}

export interface DelayNotificationEvent extends DelayCandidate {
  threshold?: number;
  type: "behind" | "on-schedule";
}

interface DelayNotificationContent {
  body: string;
  title: string;
  url: string;
}

const previousDelayMinsByKey = new Map<string, number>();

// notification state reset
export const resetDelayNotificationState = (): void => {
  previousDelayMinsByKey.clear();
};

// active GPS match
const hasMatchingGpsDelay = (slot: Schedule["slots"][number]): boolean => {
  return slot.vessel?.gpsDelay?.signals.scheduledDepartureTime === slot.time;
};

// notification candidates
const getScheduleDelayCandidates = (schedule: Schedule): DelayCandidate[] => {
  const candidateSlotsByVesselId = new Map<string, Schedule["slots"][number]>();
  schedule.slots.forEach((slot) => {
    // cancelled slot guard
    if (slot.crossing?.isCancelled) {
      return;
    }
    const vesselId = slot.vessel?.id;
    // missing vessel guard
    if (!vesselId) {
      return;
    }
    // first candidate guard
    if (candidateSlotsByVesselId.has(vesselId)) {
      return;
    }
    // live or future guard
    if (!slot.hasPassed || hasMatchingGpsDelay(slot)) {
      candidateSlotsByVesselId.set(vesselId, slot);
    }
  });
  return Array.from(candidateSlotsByVesselId.entries()).map(
    ([vesselId, candidateSlot]) => {
      // candidate projection
      const timing = getProjectedTiming({
        schedule: schedule.slots,
        slot: candidateSlot,
      });
      return {
        delayMins: Math.max(0, timing.delayMins),
        key: `${schedule.terminalId}:${schedule.mateId}:${vesselId}`,
        mateId: schedule.mateId,
        terminalId: schedule.terminalId,
        vesselName: candidateSlot.vessel.name,
      };
    }
  );
};

// crossed threshold
const getCrossedDelayThreshold = (
  previousDelayMins: number,
  currentDelayMins: number
): number | null => {
  let crossedThreshold: number | null = null;
  // threshold scan
  for (const threshold of DELAY_THRESHOLDS) {
    // crossing guard
    if (previousDelayMins < threshold && currentDelayMins >= threshold) {
      crossedThreshold = threshold;
    }
  }
  return crossedThreshold;
};

// notification event
const getDelayNotificationEvent = (
  candidate: DelayCandidate,
  previousDelayMins: number | undefined
): DelayNotificationEvent | null => {
  // first observation guard
  if (previousDelayMins === undefined) {
    return null;
  }
  // back on schedule guard
  if (previousDelayMins > ON_SCHEDULE_THRESHOLD && candidate.delayMins <= 0) {
    return { ...candidate, type: "on-schedule" };
  }
  const threshold = getCrossedDelayThreshold(
    previousDelayMins,
    candidate.delayMins
  );
  // threshold guard
  if (!threshold) {
    return null;
  }
  return { ...candidate, threshold, type: "behind" };
};

// delay events
export const getDelayNotificationEvents = (
  schedules: Schedule[] = values(Schedule.getAll())
): DelayNotificationEvent[] => {
  const activeKeys = new Set<string>();
  const events: DelayNotificationEvent[] = [];
  // schedule scan
  schedules.forEach((schedule) => {
    // vessel scan
    getScheduleDelayCandidates(schedule).forEach((candidate) => {
      activeKeys.add(candidate.key);
      const event = getDelayNotificationEvent(
        candidate,
        previousDelayMinsByKey.get(candidate.key)
      );
      // event guard
      if (event) {
        events.push(event);
      }
      previousDelayMinsByKey.set(candidate.key, candidate.delayMins);
    });
  });
  previousDelayMinsByKey.forEach((_, key) => {
    // stale state guard
    if (!activeKeys.has(key)) {
      previousDelayMinsByKey.delete(key);
    }
  });
  return events;
};

// schedule route url
const getScheduleUrl = (terminal: Terminal, mate: Terminal): string => {
  return `${process.env.BASE_URL}/${terminal.slug}/${mate.slug}`;
};

// message content
export const formatDelayNotification = (
  event: DelayNotificationEvent
): DelayNotificationContent | null => {
  const terminal = Terminal.getByIndex(event.terminalId);
  const mate = Terminal.getByIndex(event.mateId);
  // route data guard
  if (!terminal || !mate) {
    return null;
  }
  const routeName = `${terminal.name}/${mate.name}`;
  const url = getScheduleUrl(terminal, mate);
  // recovery notification
  if (event.type === "on-schedule") {
    return {
      body: `${event.vesselName} is back on schedule`,
      title: `${routeName} is back on schedule`,
      url,
    };
  }
  return {
    body: `${event.vesselName} is running ${event.delayMins}mins late`,
    title: `${routeName} is ${event.threshold}+ mins behind`,
    url,
  };
};

// subscribed route messages
const getSubscribedRouteMessages = (
  event: DelayNotificationEvent,
  content: DelayNotificationContent
): Promise<Message[]> => {
  return getSubscribedTerminalPushMessages({
    data: {
      body: content.body,
      date: String(Math.floor(Date.now() / 1000)),
      terminalId: event.terminalId,
      title: content.title,
      url: content.url,
    },
    terminalIds: [event.terminalId, event.mateId],
  });
};

// send delay notifications
export const sendDelayNotifications = async (): Promise<void> => {
  const events = getDelayNotificationEvents();
  // event queue
  for (const event of events) {
    const content = formatDelayNotification(event);
    // content guard
    if (!content) {
      continue;
    }
    const messages = await getSubscribedRouteMessages(event, content);
    // message queue
    for (const message of messages) {
      await sendPush(message);
    }
  }
};
