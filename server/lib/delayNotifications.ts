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
  mateId: string;
  terminalId: string;
  vesselName: string;
}

interface RouteDelayVessel {
  delayMins: number;
  vesselName: string;
}

interface RouteDelayState {
  delayMins: number;
  key: string;
  mateId: string;
  terminalId: string;
  vessels: RouteDelayVessel[];
}

type DelayNotificationBehindEvent = RouteDelayState & {
  threshold: number;
  type: "behind";
};

type DelayNotificationRecoveryEvent = RouteDelayState & {
  threshold?: never;
  type: "on-schedule";
};

export type DelayNotificationEvent =
  | DelayNotificationBehindEvent
  | DelayNotificationRecoveryEvent;

interface DelayNotificationContent {
  body: string;
  title: string;
  url: string;
}

const notifiedThresholdByRouteKey = new Map<string, number>();

// notification state reset
export const resetDelayNotificationState = (): void => {
  notifiedThresholdByRouteKey.clear();
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
  return Array.from(candidateSlotsByVesselId.values()).map((candidateSlot) => {
    // candidate projection
    const timing = getProjectedTiming({
      schedule: schedule.slots,
      slot: candidateSlot,
    });
    return {
      delayMins: Math.max(0, timing.delayMins),
      mateId: schedule.mateId,
      terminalId: schedule.terminalId,
      vesselName: candidateSlot.vessel.name,
    };
  });
};

// route key
const getRouteKey = (terminalId: string, mateId: string): string => {
  return `${terminalId}:${mateId}`;
};

// highest delay threshold
const getDelayThreshold = (delayMins: number): number => {
  let crossedThreshold = 0;
  // threshold scan
  for (const threshold of DELAY_THRESHOLDS) {
    // threshold reached guard
    if (delayMins >= threshold) {
      crossedThreshold = threshold;
    }
  }
  return crossedThreshold;
};

// route delay state
const getRouteDelayState = (
  schedule: Schedule,
  candidates: DelayCandidate[]
): RouteDelayState => {
  const delayedVessels = candidates
    .filter((candidate) => {
      // delayed vessel guard
      return candidate.delayMins > 0;
    })
    .sort((left, right) => {
      // largest delay first
      return right.delayMins - left.delayMins;
    })
    .map(({ delayMins, vesselName }) => {
      return { delayMins, vesselName };
    });
  return {
    delayMins: Math.max(0, ...candidates.map(({ delayMins }) => delayMins)),
    key: getRouteKey(schedule.terminalId, schedule.mateId),
    mateId: schedule.mateId,
    terminalId: schedule.terminalId,
    vessels: delayedVessels,
  };
};

// notification event
const getDelayNotificationEvent = (
  routeState: RouteDelayState,
  previousThreshold: number | undefined
): DelayNotificationEvent | null => {
  // first observation guard
  if (previousThreshold === undefined) {
    return null;
  }
  // back on schedule guard
  if (previousThreshold >= ON_SCHEDULE_THRESHOLD && routeState.delayMins <= 0) {
    return { ...routeState, type: "on-schedule" };
  }
  const threshold = getDelayThreshold(routeState.delayMins);
  // escalation guard
  if (threshold <= previousThreshold) {
    return null;
  }
  return { ...routeState, threshold, type: "behind" };
};

// next route threshold state
const getNextNotifiedThreshold = (
  event: DelayNotificationEvent | null,
  previousThreshold: number | undefined,
  routeState: RouteDelayState
): number => {
  // initial state guard
  if (previousThreshold === undefined) {
    return getDelayThreshold(routeState.delayMins);
  }
  // recovery guard
  if (event?.type === "on-schedule") {
    return 0;
  }
  // escalation guard
  if (event?.type === "behind" && event.threshold) {
    return event.threshold;
  }
  return Math.min(previousThreshold, getDelayThreshold(routeState.delayMins));
};

// delay events
export const getDelayNotificationEvents = (
  schedules: Schedule[] = values(Schedule.getAll())
): DelayNotificationEvent[] => {
  const activeKeys = new Set<string>();
  const events: DelayNotificationEvent[] = [];
  // schedule scan
  schedules.forEach((schedule) => {
    const candidates = getScheduleDelayCandidates(schedule);
    // empty route guard
    if (candidates.length === 0) {
      return;
    }
    const routeState = getRouteDelayState(schedule, candidates);
    const previousThreshold = notifiedThresholdByRouteKey.get(routeState.key);
    const event = getDelayNotificationEvent(routeState, previousThreshold);
    activeKeys.add(routeState.key);
    // event guard
    if (event) {
      events.push(event);
    }
    notifiedThresholdByRouteKey.set(
      routeState.key,
      getNextNotifiedThreshold(event, previousThreshold, routeState)
    );
  });
  notifiedThresholdByRouteKey.forEach((_, key) => {
    // stale state guard
    if (!activeKeys.has(key)) {
      notifiedThresholdByRouteKey.delete(key);
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
      body: "All ferries are back on schedule",
      title: `${routeName} is back on schedule`,
      url,
    };
  }
  const body =
    event.vessels.length > 0
      ? event.vessels
          .map(({ delayMins, vesselName }) => {
            // vessel delay summary
            return `${vesselName} is ${delayMins}mins late`;
          })
          .join("; ")
      : "Ferries are running behind schedule";
  return {
    body,
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
    channel: "delays",
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
