import { Message } from "firebase-admin/messaging";
import { DateTime } from "luxon";
import type { Slot } from "shared/contracts/schedules";
import { values } from "shared/lib/objects";
import { getTidalCancellationRisk } from "shared/lib/tidalCancellationRisk";

import { sendPush } from "~/lib/push";
import { getSubscribedTerminalPushMessages } from "~/lib/pushSubscriptions";
import { toWsfDate } from "~/lib/wsf/date";
import { Schedule } from "~/models/Schedule";
import { Terminal } from "~/models/Terminal";

type CancellationState =
  | "cancelled-non-tidal"
  | "cancelled-tidal"
  | "clear"
  | "tidal-risk";

type CancellationEventType =
  | "cancelled-non-tidal"
  | "cancelled-tidal"
  | "risk-cleared"
  | "tidal-risk";

interface CancellationCandidate {
  isCurrentServiceDay: boolean;
  key: string;
  mateId: string;
  previous?: CancellationNotificationState;
  state: CancellationState;
  terminalId: string;
  time: number;
}

export interface CancellationNotificationEvent extends CancellationCandidate {
  type: CancellationEventType;
}

interface CancellationNotificationContent {
  body: string;
  title: string;
  url: string;
}

interface CancellationNotificationState {
  isCurrentServiceDay: boolean;
  state: CancellationState;
}

const previousCancellationStateByKey = new Map<
  string,
  CancellationNotificationState
>();

// notification state reset
export const resetCancellationNotificationState = (): void => {
  previousCancellationStateByKey.clear();
};

// current service day guard
const isCurrentServiceDay = (schedule: Schedule): boolean => {
  return schedule.date === toWsfDate();
};

// sailing key
const getSailingKey = (schedule: Schedule, slot: Slot): string => {
  return `${schedule.terminalId}:${schedule.mateId}:${slot.time}`;
};

// route event key
const getRouteEventKey = ({
  mateId,
  terminalId,
}: {
  mateId: string;
  terminalId: string;
}): string => {
  return [terminalId, mateId].sort().join(":");
};

// cancellation state
const getCancellationState = (
  schedule: Schedule,
  slot: Slot
): CancellationState => {
  const isCancelled = slot.crossing?.isCancelled ?? false;
  // tidal cancellation guard
  if (isCancelled && slot.cancellationReason === "tidal") {
    return "cancelled-tidal";
  }
  // non-tidal cancellation guard
  if (isCancelled) {
    return "cancelled-non-tidal";
  }
  const risk = getTidalCancellationRisk({
    departureTerminalId: schedule.terminalId,
    slot,
  });
  // tidal risk guard
  if (risk?.title === "Tidal cancellation risk") {
    return "tidal-risk";
  }
  return "clear";
};

// notification candidate
const getCancellationCandidate = (
  schedule: Schedule,
  slot: Slot
): CancellationCandidate => {
  const key = getSailingKey(schedule, slot);
  return {
    isCurrentServiceDay: isCurrentServiceDay(schedule),
    key,
    mateId: schedule.mateId,
    previous: previousCancellationStateByKey.get(key),
    state: getCancellationState(schedule, slot),
    terminalId: schedule.terminalId,
    time: slot.time,
  };
};

// event type
const getCancellationEventType = ({
  isCurrentServiceDay,
  previous,
  state,
}: CancellationCandidate): CancellationEventType | null => {
  // first observation guard
  if (!previous) {
    return null;
  }
  const isCurrentDayRollover =
    !previous.isCurrentServiceDay && isCurrentServiceDay;
  // rollover event guard
  if (isCurrentDayRollover) {
    // rollover cancellation guard
    if (state === "cancelled-tidal") {
      return "cancelled-tidal";
    }
    // rollover non-tidal guard
    if (state === "cancelled-non-tidal") {
      return "cancelled-non-tidal";
    }
    // rollover risk guard
    if (state === "tidal-risk") {
      return "tidal-risk";
    }
    return null;
  }
  // duplicate state guard
  if (previous.state === state) {
    return null;
  }
  // tidal cancellation guard
  if (state === "cancelled-tidal") {
    return "cancelled-tidal";
  }
  // non-tidal cancellation guard
  if (state === "cancelled-non-tidal") {
    return "cancelled-non-tidal";
  }
  // risk entry guard
  if (state === "tidal-risk") {
    return "tidal-risk";
  }
  // risk clear guard
  if (previous.state === "tidal-risk" && state === "clear") {
    return "risk-cleared";
  }
  return null;
};

// suppress projected risks
const removeRisksWithConfirmedCancellations = (
  events: CancellationNotificationEvent[]
): CancellationNotificationEvent[] => {
  const confirmedRouteKeys = new Set<string>();
  // confirmed route scan
  events.forEach((event) => {
    // confirmed event guard
    if (
      event.type === "cancelled-tidal" ||
      event.type === "cancelled-non-tidal"
    ) {
      confirmedRouteKeys.add(getRouteEventKey(event));
    }
  });
  return events.filter((event) => {
    // confirmed beats projected
    if (
      event.type === "tidal-risk" &&
      confirmedRouteKeys.has(getRouteEventKey(event))
    ) {
      return false;
    }
    return true;
  });
};

// cancellation events
export const getCancellationNotificationEvents = (
  schedules: Schedule[] = values(Schedule.getAll())
): CancellationNotificationEvent[] => {
  const activeKeys = new Set<string>();
  const events: CancellationNotificationEvent[] = [];
  // schedule scan
  schedules.forEach((schedule) => {
    // slot scan
    schedule.slots.forEach((slot) => {
      const candidate = getCancellationCandidate(schedule, slot);
      activeKeys.add(candidate.key);
      const type = getCancellationEventType(candidate);
      const isRiskClearForPastSailing =
        type === "risk-cleared" && slot.hasPassed;
      const isInitialPastSailing =
        !candidate.previous && slot.hasPassed && candidate.state !== "clear";
      // event guard
      if (
        candidate.isCurrentServiceDay &&
        type &&
        !isRiskClearForPastSailing &&
        !isInitialPastSailing
      ) {
        events.push({ ...candidate, type });
      }
      previousCancellationStateByKey.set(candidate.key, {
        isCurrentServiceDay: candidate.isCurrentServiceDay,
        state: candidate.state,
      });
    });
  });
  previousCancellationStateByKey.forEach((_, key) => {
    // stale state guard
    if (!activeKeys.has(key)) {
      previousCancellationStateByKey.delete(key);
    }
  });
  return removeRisksWithConfirmedCancellations(events);
};

// route path
const getRoutePath = (
  terminal: Terminal,
  mate: Terminal,
  view?: "alerts"
): string => {
  const viewPath = view ? `/${view}` : "";
  return `${process.env.BASE_URL}/${terminal.slug}/${mate.slug}${viewPath}`;
};

// sailing label
const getSailingTimeLabel = (time: number): string => {
  return DateTime.fromSeconds(time).toFormat("h:mm a");
};

// message content
export const formatCancellationNotification = (
  event: CancellationNotificationEvent
): CancellationNotificationContent | null => {
  const terminal = Terminal.getByIndex(event.terminalId);
  const mate = Terminal.getByIndex(event.mateId);
  // route data guard
  if (!terminal || !mate) {
    return null;
  }
  const routeName = `${terminal.name}/${mate.name}`;
  const sailingTime = getSailingTimeLabel(event.time);
  // risk notification
  if (event.type === "tidal-risk") {
    return {
      body: `The ${sailingTime} sailing is at tidal cancellation risk.`,
      title: `${routeName} may have cancellations`,
      url: getRoutePath(terminal, mate),
    };
  }
  // tidal confirmed notification
  if (event.type === "cancelled-tidal") {
    return {
      body: `WSF cancelled the ${sailingTime} sailing due to tidal conditions.`,
      title: `${routeName} has cancellations`,
      url: getRoutePath(terminal, mate),
    };
  }
  // non-tidal confirmed notification
  if (event.type === "cancelled-non-tidal") {
    return {
      body: `WSF cancelled the ${sailingTime} sailing.`,
      title: `${routeName} has cancellations`,
      url: getRoutePath(terminal, mate, "alerts"),
    };
  }
  return {
    body: `The ${sailingTime} sailing is no longer projected to be cancelled.`,
    title: `${routeName} cancellation risk cleared`,
    url: getRoutePath(terminal, mate),
  };
};

// subscribed route messages
const getSubscribedRouteMessages = (
  event: CancellationNotificationEvent,
  content: CancellationNotificationContent
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

// send cancellation notifications
export const sendCancellationNotifications = async (): Promise<void> => {
  const events = getCancellationNotificationEvents();
  // event queue
  for (const event of events) {
    const content = formatCancellationNotification(event);
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
