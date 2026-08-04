export type ScheduleSailingContext = "day" | "night";

export type ScheduleRowState = "confirmed" | "full" | "normal";

interface ScheduleColorOptions {
  isDaylight: boolean;
}

interface ScheduleRowStateOptions {
  hasConfirmedCapacity: boolean;
  isFull: boolean;
}

export const getScheduleSailingContext = ({
  isDaylight,
}: ScheduleColorOptions): ScheduleSailingContext => {
  // daylight context
  if (isDaylight) {
    return "day";
  }
  return "night";
};

export const getScheduleRowState = ({
  hasConfirmedCapacity,
  isFull,
}: ScheduleRowStateOptions): ScheduleRowState => {
  // full state wins
  if (isFull) {
    return "full";
  }
  // live capacity state
  if (hasConfirmedCapacity) {
    return "confirmed";
  }
  return "normal";
};

export const getScheduleRowClassName = (
  context: ScheduleSailingContext
): string => {
  // daylight background
  if (context === "day") {
    return [
      "bg-day-normal-light dark:bg-day-normal-dark",
      "text-[#3d3d3d] dark:text-[#f0ece0]",
    ].join(" ");
  }
  return [
    "bg-night-normal-light dark:bg-night-normal-dark",
    "text-[#3d3d3d] dark:text-[#e0f0f4]",
  ].join(" ");
};

export const getScheduleTimeMajorClassName = (
  context: ScheduleSailingContext,
  state: ScheduleRowState
): string => {
  // full row time
  if (state === "full") {
    return context === "day"
      ? "text-[#3d3d3d] dark:text-[#fef9eb]"
      : "text-white dark:text-[#e0f0f4]";
  }
  // confirmed row time
  if (state === "confirmed") {
    return context === "day"
      ? "text-[#3d3d3d] dark:text-[#fef9eb]"
      : "text-white dark:text-[#e0f0f4]";
  }
  return context === "day"
    ? "text-[#3d3d3d] dark:text-[#f0ece0]"
    : "text-[#3d3d3d] dark:text-[#e0f0f4]";
};

export const getScheduleTimeMinorClassName = (
  context: ScheduleSailingContext,
  state: ScheduleRowState
): string => {
  // full row timestamp
  if (state === "full") {
    return context === "day"
      ? "text-[#7a5400] dark:text-[#f2b705]"
      : "text-[#b8d5de] dark:text-[#6fb8c8]";
  }
  // confirmed row timestamp
  if (state === "confirmed") {
    return context === "day"
      ? "text-[#7a5400] dark:text-[#f2b705]"
      : "text-[#b8d5de] dark:text-[#6fb8c8]";
  }
  return context === "day"
    ? "text-[#5f5f5f] dark:text-[#a69764]"
    : "text-[#4f6570] dark:text-[#72a9b5]";
};

interface ScheduleLiveSpaceStateOptions {
  hasForecastExtension: boolean;
  isFull: boolean;
  statusSide: "left" | "right";
}

export const getScheduleLiveSpaceState = ({
  hasForecastExtension,
  isFull,
  statusSide,
}: ScheduleLiveSpaceStateOptions): ScheduleRowState => {
  // full state wins
  if (isFull) {
    return "full";
  }
  // right labels sit off the confirmed fill
  if (hasForecastExtension && statusSide === "right") {
    return "normal";
  }
  return "confirmed";
};

export const getScheduleSpaceClassName = (
  context: ScheduleSailingContext,
  state: ScheduleRowState
): string => {
  // full capacity label
  if (state === "full") {
    return context === "day"
      ? "text-[#7a5400] dark:text-[#fce580]"
      : "text-[#1f5664] dark:text-[#b8e4f0]";
  }
  // live capacity label
  if (state === "confirmed") {
    return context === "day"
      ? "text-[#7a5400] dark:text-[#fce580]"
      : "text-[#1f5664] dark:text-[#b8e4f0]";
  }
  return context === "day"
    ? "text-[#a07c30] dark:text-[#c49a30]"
    : "text-[#1f5664] dark:text-[#5aa0b0]";
};

export const getLateTextClassName = (): string =>
  "text-late-light dark:text-late-dark";
