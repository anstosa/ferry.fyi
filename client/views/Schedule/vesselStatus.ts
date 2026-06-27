import { DateTime } from "luxon";
import type { Slot } from "shared/contracts/schedules";
import { pluralize } from "shared/lib/strings";

// round eta minutes
export const getRoundedEtaMinutes = (
  estimatedArrivalTime: number | undefined,
  time: DateTime
): number | null => {
  // missing eta guard
  if (!estimatedArrivalTime) {
    return null;
  }
  const etaMins = DateTime.fromSeconds(estimatedArrivalTime)
    .diff(time)
    .as("minutes");
  return Math.max(0, Math.round(etaMins));
};

// round status number
export const roundStatusNumber = (value: number): number => Math.round(value);

interface IsAfterCurrentSlotOptions {
  currentSlot: Slot | null;
  schedule: Slot[];
  slot: Slot;
}

// future slot check
export const isAfterCurrentSlot = ({
  currentSlot,
  schedule,
  slot,
}: IsAfterCurrentSlotOptions): boolean => {
  // no current sailing guard
  if (!currentSlot) {
    return false;
  }
  const sortedSlots = [...schedule].sort(
    (left, right) => left.time - right.time
  );
  const currentIndex = sortedSlots.indexOf(currentSlot);
  const slotIndex = sortedSlots.indexOf(slot);
  return currentIndex >= 0 && slotIndex > currentIndex;
};

// forecast delay label
export const getForecastLateText = (delayMins: number): string | null => {
  // on-time guard
  if (delayMins <= 0) {
    return null;
  }
  return `Forecast ${pluralize(roundStatusNumber(delayMins), "min")} late`;
};

export interface DelayCardSignal {
  label: string;
  value: string;
}

export interface DelayCardModel {
  isConfirmed: boolean;
  isLate: boolean;
  isProjected: boolean;
  signals: DelayCardSignal[];
  title: string;
}

interface DelayCardModelOptions {
  delayMins: number;
  slot: Slot;
}

// delay seconds label
export const formatDelaySeconds = (seconds?: number | null): string => {
  // unavailable signal guard
  if (seconds === null || seconds === undefined) {
    return "Unavailable";
  }
  const mins = roundStatusNumber(seconds / 60);
  // on-time signal guard
  if (mins === 0) {
    return "On time";
  }
  const direction = mins < 0 ? "ahead" : "late";
  return `${pluralize(Math.abs(mins), "min")} ${direction}`;
};

// delay card title
const getDelayCardTitle = (seconds: number, hasPassed?: boolean): string => {
  const delayText = formatDelaySeconds(seconds);
  // past sailing guard
  if (hasPassed) {
    return delayText;
  }
  return `Projected ${delayText.toLowerCase()}`;
};

// scheduled crossing label
const getScheduledWindowText = (slot: Slot): string => {
  const departureTime = DateTime.fromSeconds(slot.time).toFormat("h:mm a");
  // missing arrival guard
  if (!slot.arrivalTime) {
    return `Departs ${departureTime}`;
  }
  const arrivalTime = DateTime.fromSeconds(slot.arrivalTime).toFormat("h:mm a");
  return `${departureTime} → ${arrivalTime}`;
};

// vessel report label
const getVesselReportText = (slot: Slot): string =>
  formatDelaySeconds(slot.vessel.departureDelta);

// expanded delay model
export const getDelayCardModel = ({
  delayMins,
  slot,
}: DelayCardModelOptions): DelayCardModel => {
  const { gpsDelay } = slot.vessel;
  // GPS delay guard
  if (gpsDelay?.signals.scheduledDepartureTime === slot.time) {
    return {
      isConfirmed: slot.hasPassed,
      isLate: gpsDelay.delaySeconds > 0,
      isProjected: !slot.hasPassed,
      signals: [
        { label: "Schedule", value: getScheduledWindowText(slot) },
        {
          label: "GPS Reports",
          value: formatDelaySeconds(gpsDelay.delaySeconds),
        },
        {
          label: "Terminal Reports",
          value: formatDelaySeconds(gpsDelay.signals.dockDelaySeconds),
        },
        { label: "Vessel Reports", value: getVesselReportText(slot) },
      ],
      title: getDelayCardTitle(gpsDelay.delaySeconds, slot.hasPassed),
    };
  }
  const title = getDelayCardTitle(delayMins * 60, slot.hasPassed);
  return {
    isConfirmed: slot.hasPassed,
    isLate: delayMins > 0,
    isProjected: !slot.hasPassed,
    signals: [
      { label: "Schedule", value: getScheduledWindowText(slot) },
      { label: "GPS Reports", value: formatDelaySeconds(delayMins * 60) },
      {
        label: "Terminal Reports",
        value: formatDelaySeconds(slot.crossing?.departureDelta),
      },
      { label: "Vessel Reports", value: getVesselReportText(slot) },
    ],
    title,
  };
};
