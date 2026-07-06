import { Message } from "firebase-admin/messaging";
import { DateTime } from "luxon";
import type { MapPoint } from "shared/contracts/cameras";
import type { Slot } from "shared/contracts/schedules";
import type { Vessel } from "shared/contracts/vessels";
import { values } from "shared/lib/objects";

import { sendPush } from "~/lib/push";
import { getSubscribedTerminalPushMessages } from "~/lib/pushSubscriptions";
import { toWsfDate } from "~/lib/wsf/date";
import { Schedule } from "~/models/Schedule";
import { Terminal } from "~/models/Terminal";
import { Vessel as VesselModel } from "~/models/Vessel";

const ALERT_CHANNEL = "sailing-updates";
const BOARDING_DOCK_GRACE_SECONDS = 10 * 60;
const DEPARTURE_GRACE_SECONDS = 10 * 60;
const ARRIVAL_DOCK_GRACE_SECONDS = 10 * 60;
const MAX_PRE_DEPARTURE_SECONDS = 3 * 60 * 60;
const MAX_POST_ARRIVAL_SECONDS = 30 * 60;
const DISEMBARK_ETA_SECONDS = 5 * 60;
const NOTABLE_DELAY_SECONDS = 3 * 60;
const TERMINAL_DISTANCE_MILES = 0.35;
const EARTH_RADIUS_MILES = 3958.8;

export type SailingLifecycleEventType =
  | "arrived"
  | "departed"
  | "prepare-board"
  | "prepare-disembark";

export interface SailingLifecycleNotificationEvent {
  arrivalTime: number | null;
  departedTime: number | null;
  dockedTime: number | null;
  estimatedArrivalTime: number | null;
  key: string;
  mateId: string;
  routeDate: string;
  terminalId: string;
  time: number;
  type: SailingLifecycleEventType;
  vesselName: string;
}

interface SailingLifecycleCandidate {
  arrivalTime: number | null;
  departedTime: number | null;
  dockedTime: number | null;
  estimatedArrivalTime: number | null;
  isAtArrivalDock: boolean;
  isAtDepartureDock: boolean;
  key: string;
  mateId: string;
  routeDate: string;
  terminalId: string;
  time: number;
  vesselName: string;
}

interface SailingLifecycleNotificationContent {
  body: string;
  title: string;
  url: string;
}

const sentLifecycleEventsByKey = new Map<
  string,
  Set<SailingLifecycleEventType>
>();

// notification state reset
export const resetSailingLifecycleNotificationState = (): void => {
  sentLifecycleEventsByKey.clear();
};

// timestamp normalizer
const normalizeTimestampSeconds = (time?: number | null): number | null => {
  // missing timestamp guard
  if (!time) {
    return null;
  }
  // millisecond timestamp guard
  if (time > 100_000_000_000) {
    return Math.round(time / 1000);
  }
  return time;
};

// radians conversion
const toRadians = (degrees: number): number => {
  return (degrees * Math.PI) / 180;
};

// terminal distance
const getDistanceMiles = (first: MapPoint, second: MapPoint): number => {
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);
  return (
    EARTH_RADIUS_MILES *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
};

// vessel terminal proximity
const isVesselNearTerminal = (vessel: Vessel, terminal: Terminal): boolean => {
  // location guard
  if (!vessel.location) {
    return false;
  }
  return (
    getDistanceMiles(vessel.location, terminal.location) <=
    TERMINAL_DISTANCE_MILES
  );
};

// docked at departure
const isAtDepartureDock = ({
  now,
  slot,
  terminal,
  vessel,
}: {
  now: number;
  slot: Slot;
  terminal: Terminal;
  vessel: Vessel;
}): boolean => {
  // dock status guard
  if (!vessel.isAtDock) {
    return false;
  }
  // sailing time guard
  if (now > slot.time + BOARDING_DOCK_GRACE_SECONDS) {
    return false;
  }
  const vesselTerminalIds = [
    vessel.departingTerminalId,
    vessel.arrivingTerminalId,
  ].map((terminalId) => String(terminalId ?? ""));
  return (
    vesselTerminalIds.includes(terminal.id) ||
    isVesselNearTerminal(vessel, terminal)
  );
};

// docked at arrival
const isAtArrivalDock = ({
  mate,
  now,
  slot,
  vessel,
}: {
  mate: Terminal;
  now: number;
  slot: Slot;
  vessel: Vessel;
}): boolean => {
  // dock status guard
  if (!vessel.isAtDock) {
    return false;
  }
  // departure guard
  if (now < slot.time) {
    return false;
  }
  const vesselTerminalIds = [
    vessel.departingTerminalId,
    vessel.arrivingTerminalId,
  ].map((terminalId) => String(terminalId ?? ""));
  return (
    vesselTerminalIds.includes(mate.id) || isVesselNearTerminal(vessel, mate)
  );
};

// projected arrival time
const getEstimatedArrivalTime = (slot: Slot, vessel: Vessel): number | null => {
  const vesselEta = normalizeTimestampSeconds(vessel.estimatedArrivalTime);
  // vessel eta guard
  if (vesselEta) {
    return vesselEta;
  }
  const { gpsDelay } = vessel;
  // GPS arrival guard
  if (gpsDelay) {
    return gpsDelay.signals.scheduledArrivalTime + gpsDelay.delaySeconds;
  }
  return normalizeTimestampSeconds(slot.arrivalTime);
};

// active route window
const isInActiveSailingWindow = ({
  arrivalTime,
  now,
  slot,
}: {
  arrivalTime: number | null;
  now: number;
  slot: Slot;
}): boolean => {
  const windowStart = slot.time - MAX_PRE_DEPARTURE_SECONDS;
  const windowEnd = (arrivalTime ?? slot.time) + MAX_POST_ARRIVAL_SECONDS;
  return now >= windowStart && now <= windowEnd;
};

// candidate key
const getSailingLifecycleKey = (schedule: Schedule, slot: Slot): string => {
  return [schedule.terminalId, schedule.mateId, slot.time, slot.vessel.id].join(
    ":"
  );
};

// build candidate
const getSailingLifecycleCandidate = ({
  now,
  schedule,
  slot,
}: {
  now: number;
  schedule: Schedule;
  slot: Slot;
}): SailingLifecycleCandidate | null => {
  // cancelled sailing guard
  if (slot.crossing?.isCancelled) {
    return null;
  }
  const terminal = Terminal.getByIndex(schedule.terminalId);
  const mate = Terminal.getByIndex(schedule.mateId);
  const vessel = VesselModel.getByIndex(slot.vessel.id) ?? slot.vessel;
  // route data guard
  if (!terminal || !mate || !vessel?.id) {
    return null;
  }
  const estimatedArrivalTime = getEstimatedArrivalTime(slot, vessel);
  // active window guard
  if (
    !isInActiveSailingWindow({ arrivalTime: estimatedArrivalTime, now, slot })
  ) {
    return null;
  }
  const departedTime = normalizeTimestampSeconds(vessel.departedTime);
  const dockedTime = normalizeTimestampSeconds(vessel.dockedTime);
  return {
    arrivalTime: normalizeTimestampSeconds(slot.arrivalTime),
    departedTime,
    dockedTime,
    estimatedArrivalTime,
    isAtArrivalDock: isAtArrivalDock({ mate, now, slot, vessel }),
    isAtDepartureDock: isAtDepartureDock({ now, slot, terminal, vessel }),
    key: getSailingLifecycleKey(schedule, slot),
    mateId: schedule.mateId,
    routeDate: schedule.date,
    terminalId: schedule.terminalId,
    time: slot.time,
    vesselName: vessel.name,
  };
};

// sent event guard
const hasSentEvent = (
  candidate: SailingLifecycleCandidate,
  type: SailingLifecycleEventType
): boolean => {
  return sentLifecycleEventsByKey.get(candidate.key)?.has(type) ?? false;
};

// event mark
const markEventSent = (
  candidate: SailingLifecycleCandidate,
  type: SailingLifecycleEventType
): void => {
  const sentEvents = sentLifecycleEventsByKey.get(candidate.key) ?? new Set();
  sentEvents.add(type);
  sentLifecycleEventsByKey.set(candidate.key, sentEvents);
};

// build event
const createEvent = (
  candidate: SailingLifecycleCandidate,
  type: SailingLifecycleEventType
): SailingLifecycleNotificationEvent => {
  return { ...candidate, type };
};

// event conditions
const getCandidateEvents = ({
  candidate,
  now,
}: {
  candidate: SailingLifecycleCandidate;
  now: number;
}): SailingLifecycleNotificationEvent[] => {
  const events: SailingLifecycleNotificationEvent[] = [];
  const recentDocking =
    candidate.dockedTime !== null &&
    now >= candidate.dockedTime &&
    now - candidate.dockedTime <= ARRIVAL_DOCK_GRACE_SECONDS;
  const recentDeparture =
    candidate.departedTime !== null &&
    now >= candidate.departedTime &&
    now - candidate.departedTime <= DEPARTURE_GRACE_SECONDS;
  const etaSeconds = candidate.estimatedArrivalTime
    ? candidate.estimatedArrivalTime - now
    : null;
  // boarding event guard
  if (
    candidate.isAtDepartureDock &&
    recentDocking &&
    !hasSentEvent(candidate, "prepare-board")
  ) {
    events.push(createEvent(candidate, "prepare-board"));
    markEventSent(candidate, "prepare-board");
  }
  // departure event guard
  if (recentDeparture && !hasSentEvent(candidate, "departed")) {
    events.push(createEvent(candidate, "departed"));
    markEventSent(candidate, "departed");
  }
  // disembark event guard
  if (
    etaSeconds !== null &&
    etaSeconds >= 0 &&
    etaSeconds <= DISEMBARK_ETA_SECONDS &&
    !candidate.isAtArrivalDock &&
    !hasSentEvent(candidate, "prepare-disembark")
  ) {
    events.push(createEvent(candidate, "prepare-disembark"));
    markEventSent(candidate, "prepare-disembark");
  }
  // arrival event guard
  if (
    candidate.isAtArrivalDock &&
    recentDocking &&
    !hasSentEvent(candidate, "arrived")
  ) {
    events.push(createEvent(candidate, "arrived"));
    markEventSent(candidate, "arrived");
  }
  return events;
};

// lifecycle events
export const getSailingLifecycleNotificationEvents = (
  schedules: Schedule[] = values(Schedule.getAll()),
  now: number = DateTime.local().toSeconds()
): SailingLifecycleNotificationEvent[] => {
  const activeKeys = new Set<string>();
  const events: SailingLifecycleNotificationEvent[] = [];
  // schedule scan
  schedules.forEach((schedule) => {
    // service day guard
    if (schedule.date !== toWsfDate()) {
      return;
    }
    // slot scan
    schedule.slots.forEach((slot) => {
      const candidate = getSailingLifecycleCandidate({ now, schedule, slot });
      // candidate guard
      if (!candidate) {
        return;
      }
      activeKeys.add(candidate.key);
      events.push(...getCandidateEvents({ candidate, now }));
    });
  });
  sentLifecycleEventsByKey.forEach((_, key) => {
    // stale event state guard
    if (!activeKeys.has(key)) {
      sentLifecycleEventsByKey.delete(key);
    }
  });
  return events;
};

// route path
const getSailingUrl = (
  terminal: Terminal,
  mate: Terminal,
  event: SailingLifecycleNotificationEvent
): string => {
  const url = new URL(`${process.env.BASE_URL}/${terminal.slug}/${mate.slug}`);
  url.searchParams.set("date", event.routeDate);
  url.searchParams.set("sailing", String(event.time));
  url.searchParams.set("tab", "sailing");
  return url.toString();
};

// delay copy
const getDelayDescription = (delaySeconds: number | null): string => {
  // delay threshold guard
  if (delaySeconds !== null && delaySeconds > NOTABLE_DELAY_SECONDS) {
    return `${Math.round(delaySeconds / 60)} mins late`;
  }
  return "on time";
};

// board instruction
const getBoardingInstruction = (terminal: Terminal): string => {
  const walkOnTarget = terminal.hasOverheadLoading
    ? "the overhead passenger loading area"
    : "the dock";
  return `Return to your vehicle. Walk-on passengers should report to ${walkOnTarget}.`;
};

// disembark instruction
const getDisembarkInstruction = (mate: Terminal): string => {
  const walkOnTarget = mate.hasOverheadLoading
    ? "the front of the passenger cabin"
    : "the front of the car deck";
  return `Return to your vehicle. Walk-on passengers should report to ${walkOnTarget}.`;
};

// message content
export const formatSailingLifecycleNotification = (
  event: SailingLifecycleNotificationEvent
): SailingLifecycleNotificationContent | null => {
  const terminal = Terminal.getByIndex(event.terminalId);
  const mate = Terminal.getByIndex(event.mateId);
  // route data guard
  if (!terminal || !mate) {
    return null;
  }
  const url = getSailingUrl(terminal, mate, event);
  // boarding notification
  if (event.type === "prepare-board") {
    return {
      body: `${event.vesselName} has docked. ${getBoardingInstruction(terminal)}`,
      title: "Prepare to board",
      url,
    };
  }
  // departure notification
  if (event.type === "departed") {
    const delaySeconds = event.departedTime
      ? event.departedTime - event.time
      : null;
    return {
      body: `${event.vesselName} departed ${getDelayDescription(delaySeconds)}.`,
      title: "Vessel has departed",
      url,
    };
  }
  // disembark notification
  if (event.type === "prepare-disembark") {
    return {
      body: `${event.vesselName} is about 5 mins from ${mate.name}. ${getDisembarkInstruction(mate)}`,
      title: "Prepare to disembark",
      url,
    };
  }
  const delaySeconds =
    event.dockedTime && event.arrivalTime
      ? event.dockedTime - event.arrivalTime
      : null;
  return {
    body: `${event.vesselName} arrived ${getDelayDescription(delaySeconds)}.`,
    title: "Vessel has arrived",
    url,
  };
};

// subscribed one-time messages
const getSubscribedSailingMessages = (
  event: SailingLifecycleNotificationEvent,
  content: SailingLifecycleNotificationContent
): Promise<Message[]> => {
  return getSubscribedTerminalPushMessages({
    channel: ALERT_CHANNEL,
    data: {
      body: content.body,
      date: String(Math.floor(Date.now() / 1000)),
      terminalId: event.terminalId,
      title: content.title,
      url: content.url,
    },
    departureTerminalId: event.terminalId,
    departureTimes: [event.time],
    oneTimeOnly: true,
    terminalIds: [event.terminalId, event.mateId],
  });
};

// send lifecycle notifications
export const sendSailingLifecycleNotifications = async (): Promise<void> => {
  const events = getSailingLifecycleNotificationEvents();
  // event queue
  for (const event of events) {
    const content = formatSailingLifecycleNotification(event);
    // content guard
    if (!content) {
      continue;
    }
    const messages = await getSubscribedSailingMessages(event, content);
    // message queue
    for (const message of messages) {
      await sendPush(message);
    }
  }
};
