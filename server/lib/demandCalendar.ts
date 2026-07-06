import { DateTime, Interval } from "luxon";
import { constrain, round } from "shared/lib/math";

import type { DemandEventType } from "~/models/DemandEvent";

const SCHOOL_BREAK_PRESSURE = 0.08;
const SPORTS_EVENT_PRESSURE = 0.1;
const SUMMER_WEEKEND_PRESSURE = 0.12;
const GATEWAY_TERMINAL_IDS = new Set(["1", "7", "8", "9", "14", "16", "17"]);
const RECREATION_TERMINAL_IDS = new Set([
  "3",
  "4",
  "5",
  "10",
  "11",
  "12",
  "13",
  "15",
  "18",
  "20",
  "21",
  "22",
]);

export interface DemandCalendarProfile {
  schoolBreakPressure: number;
  sportsEventPressure: number;
  summerWeekendPressure: number;
  totalPressure: number;
}

// demand event shape
export interface DemandCalendarEvent {
  endsAt: number;
  eventType: DemandEventType;
  pressure: number;
  startsAt: number;
  title: string;
}

interface DemandCalendarInput {
  arrivalId: string;
  departureId: string;
  events?: DemandCalendarEvent[];
  time: DateTime;
}

// third monday
const getThirdMonday = (
  year: number,
  month: number,
  zone: string
): DateTime => {
  const firstDay = DateTime.fromObject({ day: 1, month, year }, { zone });
  const daysUntilMonday = (8 - firstDay.weekday) % 7;
  return firstDay.plus({ days: daysUntilMonday + 14 }).startOf("day");
};

// generic break fallback
const isGenericSchoolBreak = (time: DateTime): boolean => {
  const monthDay = time.toFormat("MM-dd");
  // winter break guard
  if (monthDay >= "12-20" || monthDay <= "01-03") {
    return true;
  }
  // spring spread guard
  if (time.month === 4 && time.day >= 5 && time.day <= 18) {
    return true;
  }
  const presidentsDay = getThirdMonday(time.year, 2, time.zoneName ?? "local");
  return Interval.fromDateTimes(
    presidentsDay,
    presidentsDay.plus({ days: 5 })
  ).contains(time);
};

// school break pressure
const getSchoolBreakPressure = ({
  events = [],
  time,
}: DemandCalendarInput): number => {
  let eventPressure = 0;
  // event scan
  events.forEach((event) => {
    // school break guard
    if (event.eventType !== "school-break") {
      return;
    }
    const eventWindow = Interval.fromDateTimes(
      DateTime.fromSeconds(event.startsAt, { zone: time.zone }),
      DateTime.fromSeconds(event.endsAt, { zone: time.zone })
    );
    // active break guard
    if (eventWindow.contains(time)) {
      eventPressure = Math.max(eventPressure, event.pressure);
    }
  });
  // event-backed guard
  if (eventPressure > 0) {
    return eventPressure;
  }
  // fallback guard
  if (isGenericSchoolBreak(time)) {
    return SCHOOL_BREAK_PRESSURE;
  }
  return 0;
};

// gateway direction check
const isGatewayToRecreation = (
  departureId: string,
  arrivalId: string
): boolean =>
  GATEWAY_TERMINAL_IDS.has(departureId) &&
  RECREATION_TERMINAL_IDS.has(arrivalId);

// return direction check
const isRecreationToGateway = (
  departureId: string,
  arrivalId: string
): boolean =>
  RECREATION_TERMINAL_IDS.has(departureId) &&
  GATEWAY_TERMINAL_IDS.has(arrivalId);

// summer weekend pressure
const getSummerWeekendPressure = ({
  arrivalId,
  departureId,
  time,
}: DemandCalendarInput): number => {
  const isSummer = time.month >= 6 && time.month <= 9;
  // summer guard
  if (!isSummer) {
    return 0;
  }
  const outbound = isGatewayToRecreation(departureId, arrivalId);
  const inbound = isRecreationToGateway(departureId, arrivalId);
  const fridayOutbound = time.weekday === 5 && time.hour >= 12;
  const saturdayOutbound = time.weekday === 6 && time.hour <= 13;
  const sundayInbound = time.weekday === 7 && time.hour >= 10;
  const mondayInbound = time.weekday === 1 && time.hour <= 13;
  // outbound surge guard
  if (outbound && (fridayOutbound || saturdayOutbound)) {
    return SUMMER_WEEKEND_PRESSURE;
  }
  // inbound surge guard
  if (inbound && (sundayInbound || mondayInbound)) {
    return SUMMER_WEEKEND_PRESSURE;
  }
  return 0;
};

// sports pressure
const getSportsEventPressure = ({
  arrivalId,
  departureId,
  events = [],
  time,
}: DemandCalendarInput): number => {
  const inbound = isRecreationToGateway(departureId, arrivalId);
  const outbound = isGatewayToRecreation(departureId, arrivalId);
  let pressure = 0;
  // event scan
  events.forEach((event) => {
    // sports-only guard
    if (event.eventType !== "sports") {
      return;
    }
    const startsAt = DateTime.fromSeconds(event.startsAt, { zone: time.zone });
    const hoursFromStart = time.diff(startsAt, "hours").hours;
    const beforeGame = inbound && hoursFromStart >= -4 && hoursFromStart <= 1;
    const afterGame = outbound && hoursFromStart >= 2 && hoursFromStart <= 7;
    // travel window guard
    if (beforeGame || afterGame) {
      pressure += event.pressure || SPORTS_EVENT_PRESSURE;
    }
  });
  return constrain(round(pressure, 2), 0, 0.25);
};

// demand calendar profile
export const getDemandCalendarProfile = (
  input: DemandCalendarInput
): DemandCalendarProfile => {
  const schoolBreakPressure = getSchoolBreakPressure(input);
  const sportsEventPressure = getSportsEventPressure(input);
  const summerWeekendPressure = getSummerWeekendPressure(input);
  return {
    schoolBreakPressure,
    sportsEventPressure,
    summerWeekendPressure,
    totalPressure: constrain(
      round(
        schoolBreakPressure + sportsEventPressure + summerWeekendPressure,
        2
      ),
      0,
      0.35
    ),
  };
};
