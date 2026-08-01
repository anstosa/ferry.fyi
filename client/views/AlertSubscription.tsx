import { useAuth0 } from "@auth0/auth0-react";
import clsx from "clsx";
import { DateTime } from "luxon";
import React, {
  ReactElement,
  ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useLocation } from "react-router-dom";
import type { Schedule } from "shared/contracts/schedules";
import type { Terminal } from "shared/contracts/terminals";
import type {
  AlertRule,
  AlertSubscriptionChannel,
} from "shared/contracts/user";
import {
  ALERT_SUBSCRIPTION_CHANNELS,
  createFullDayAlertRule,
  EVERY_DAY_DAYS,
  getAlertRuleTimeFromDate,
  getAlertRuleTimeSeconds,
  getRouteSubscriptionKey,
  isFullDayAlertRule,
  isOneTimeAlertRule,
  isRuleForRoute,
  normalizeAlertRuleDays,
  WEEKDAY_DAYS,
  WEEKEND_DAYS,
} from "shared/lib/alertSubscriptions";
import { without } from "shared/lib/arrays";

import { AppTeaser } from "~/components/AppTeaser";
import { HeaderDropdown } from "~/components/HeaderDropdown";
import { NotificationPermissionWarning } from "~/components/NotificationPermissionWarning";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";
import { getConfiguredAuth0RedirectUri } from "~/lib/auth";
import { useDevice } from "~/lib/device";
import {
  requestNotificationPermission,
  requestPushInitialization,
} from "~/lib/push";
import { getSchedule } from "~/lib/schedule";
import { getSlug, useTerminals } from "~/lib/terminals";
import { useUser } from "~/lib/user";
import BellIcon from "~/static/images/icons/solid/bell.svg";
import BellSlashIcon from "~/static/images/icons/solid/bell-slash.svg";
import CheckIcon from "~/static/images/icons/solid/check-circle.svg";
import ArrowLeftIcon from "~/static/images/icons/solid/long-arrow-alt-left.svg";
import ArrowRightIcon from "~/static/images/icons/solid/long-arrow-alt-right.svg";

import { Header } from "./Header";

interface Props {
  mate: Terminal;
  setRoute: (target: string, mate?: string) => void;
  terminal: Terminal;
}

type ScheduleMode = "always" | "custom";
type DayPreset = "custom" | "every-day" | "weekdays" | "weekends";

interface DraftAlertRule {
  daysOfWeek: number[];
  enabled: boolean;
  endTime: string;
  id: string;
  nickname: string;
  routeKey: string;
  startTime: string;
  terminalIds: string[];
}

interface AlertRuleEditorProps {
  disabled: boolean;
  mate: Terminal;
  onChange: (rule: DraftAlertRule) => void;
  onDone: () => void;
  onRemove: () => void;
  rule: DraftAlertRule;
  terminal: Terminal;
}

interface DepartureOption {
  label: string;
  terminalIds: string[];
  value: string;
}

interface TerminalPairOption {
  key: string;
  label: string;
  mate: Terminal;
  shortLabel: string;
  terminal: Terminal;
}

interface SailingRow {
  key: string;
  terminalIds: string[];
  time: number;
}

export const AlertSubscriptionLoadingState = (): ReactElement => (
  <>
    <Header>
      <span className="text-center flex-1">Alerts</span>
    </Header>
    <main className="flex-grow overflow-y-scroll scrolling-touch bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
      <SkeletonGroup
        className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 pb-24 sm:px-6"
        label="Loading alert subscription"
      >
        <section className="rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5 shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]">
          <div className="flex items-start gap-3">
            <Skeleton className="h-11 w-11 shrink-0" variant="circle" />
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-3 w-24" variant="text" />
              <Skeleton className="h-8 w-3/5" variant="text" />
              <Skeleton className="h-4 w-full" variant="text" />
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-4 shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]">
          <Skeleton className="h-6 w-32" variant="text" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </section>
        <section className="rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-4 shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]">
          <Skeleton className="h-6 w-36" variant="text" />
          <Skeleton className="mt-3 h-4 w-3/4" variant="text" />
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </section>
      </SkeletonGroup>
    </main>
  </>
);

const DAY_OPTIONS = [
  { day: 1, label: "M" },
  { day: 2, label: "T" },
  { day: 3, label: "W" },
  { day: 4, label: "T" },
  { day: 5, label: "F" },
  { day: 6, label: "S" },
  { day: 7, label: "S" },
];

// id factory
const createRuleId = (): string => {
  return `rule-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

// channel equality guard
const areChannelsEqual = (
  left: AlertSubscriptionChannel[],
  right: AlertSubscriptionChannel[]
): boolean => {
  return (
    left.length === right.length &&
    left.every((channel) => {
      return right.includes(channel);
    })
  );
};

// collect terminal-pair choices
const getTerminalPairOptions = (
  terminals: Terminal[]
): TerminalPairOption[] => {
  const optionsByPairKey = new Map<string, TerminalPairOption>();
  // terminal pair loop
  terminals.forEach((terminal) => {
    // mate loop
    (terminal.mates ?? []).forEach((mate) => {
      const pairKey = [terminal.id, mate.id].sort().join(":");
      // duplicate direction guard
      if (optionsByPairKey.has(pairKey)) {
        return;
      }
      const [first, second] = [terminal, mate].sort((left, right) => {
        // stable pair order
        return left.name.localeCompare(right.name);
      });
      optionsByPairKey.set(pairKey, {
        key: pairKey,
        label: `${first.name} to ${second.name}`,
        mate: second,
        shortLabel: `${first.abbreviation} → ${second.abbreviation}`,
        terminal: first,
      });
    });
  });
  return Array.from(optionsByPairKey.values()).sort((left, right) => {
    // alphabetical pair order
    return left.label.localeCompare(right.label);
  });
};

// route rule filter
const getRouteRules = (
  alertRules: AlertRule[] | undefined,
  terminalIds: string[]
): AlertRule[] => {
  return (alertRules ?? []).filter((rule) => {
    // recurring route guard
    return isRuleForRoute(rule, terminalIds) && !isOneTimeAlertRule(rule);
  });
};

// draft conversion
const getDraftRules = (rules: AlertRule[]): DraftAlertRule[] => {
  return rules
    .filter((rule) => {
      return !isFullDayAlertRule(rule);
    })
    .map(
      ({
        daysOfWeek,
        enabled,
        endTime,
        id,
        nickname,
        routeKey,
        startTime,
        terminalIds,
      }) => {
        return {
          daysOfWeek,
          enabled: enabled !== false,
          endTime,
          id,
          nickname: nickname ?? "",
          routeKey,
          startTime,
          terminalIds,
        };
      }
    );
};

// rule channels
const getInitialRuleChannels = (
  routeRules: AlertRule[],
  fallbackChannels: AlertSubscriptionChannel[]
): AlertSubscriptionChannel[] => {
  const ruleChannels = routeRules.flatMap((rule) => rule.channels);
  // rule channel guard
  if (ruleChannels.length > 0) {
    return Array.from(new Set(ruleChannels));
  }
  return fallbackChannels;
};

// day preset lookup
const getDayPreset = (daysOfWeek: number[]): DayPreset => {
  const days = normalizeAlertRuleDays(daysOfWeek);
  const dayKey = days.join(":");
  // weekday guard
  if (dayKey === WEEKDAY_DAYS.join(":")) {
    return "weekdays";
  }
  // weekend guard
  if (dayKey === WEEKEND_DAYS.join(":")) {
    return "weekends";
  }
  // every-day guard
  if (dayKey === EVERY_DAY_DAYS.join(":")) {
    return "every-day";
  }
  return "custom";
};

// days by preset
const getDaysForPreset = (
  preset: DayPreset,
  currentDays: number[]
): number[] => {
  // weekday preset
  if (preset === "weekdays") {
    return WEEKDAY_DAYS;
  }
  // weekend preset
  if (preset === "weekends") {
    return WEEKEND_DAYS;
  }
  // every-day preset
  if (preset === "every-day") {
    return EVERY_DAY_DAYS;
  }
  return currentDays;
};

// next matching date
const getPreviewDate = (daysOfWeek: number[]): DateTime => {
  const today = DateTime.local().startOf("day");
  // day scan
  for (let offset = 0; offset < 14; offset += 1) {
    const candidate = today.plus({ days: offset });
    // matching weekday guard
    if (daysOfWeek.includes(candidate.weekday)) {
      return candidate;
    }
  }
  return today;
};

// readable time
const getTimeLabel = (time: string): string => {
  return DateTime.fromFormat(time, "HH:mm").toFormat("h:mm a");
};

// readable days
const getDaysLabel = (daysOfWeek: number[]): string => {
  const preset = getDayPreset(daysOfWeek);
  // preset label guard
  if (preset === "weekdays") {
    return "Weekdays";
  }
  // preset label guard
  if (preset === "weekends") {
    return "Weekends";
  }
  // preset label guard
  if (preset === "every-day") {
    return "Every day";
  }
  return DAY_OPTIONS.filter(({ day }) => daysOfWeek.includes(day))
    .map(({ label }) => label)
    .join(" ");
};

// effective end time
const getDraftRuleEndTime = (rule: DraftAlertRule): string => {
  return rule.endTime || rule.startTime;
};

// draft validity
const isDraftRuleComplete = (rule: DraftAlertRule): boolean => {
  // required fields guard
  if (
    rule.daysOfWeek.length === 0 ||
    rule.terminalIds.length === 0 ||
    !rule.startTime
  ) {
    return false;
  }
  return (
    getAlertRuleTimeSeconds(rule.startTime) <=
    getAlertRuleTimeSeconds(getDraftRuleEndTime(rule))
  );
};

// draft save error
const getDraftRuleSaveError = (rule: DraftAlertRule): string | null => {
  // sailing selection guard
  if (!rule.startTime) {
    return "Select at least one sailing for each custom window before saving.";
  }
  // day selection guard
  if (rule.daysOfWeek.length === 0) {
    return "Select at least one day for each custom window before saving.";
  }
  // terminal selection guard
  if (rule.terminalIds.length === 0) {
    return "Select a departure terminal for each custom window before saving.";
  }
  // reversed range guard
  if (
    getAlertRuleTimeSeconds(rule.startTime) >
    getAlertRuleTimeSeconds(getDraftRuleEndTime(rule))
  ) {
    return "Select the end sailing after the start sailing before saving.";
  }
  return null;
};

// custom save error
const getCustomScheduleSaveError = (rules: DraftAlertRule[]): string | null => {
  // empty window guard
  if (rules.length === 0) {
    return "Add at least one custom window before saving.";
  }
  return rules.map(getDraftRuleSaveError).find(Boolean) ?? null;
};

// draft serialization
const serializeDraftRules = (rules: DraftAlertRule[]): string => {
  return JSON.stringify(
    rules
      .map((rule) => ({
        ...rule,
        daysOfWeek: normalizeAlertRuleDays(rule.daysOfWeek),
        terminalIds: [...rule.terminalIds].sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  );
};

// schedule by direction
const getScheduleForDirection = async ({
  date,
  mate,
  terminal,
}: {
  date: DateTime;
  mate: Terminal;
  terminal: Terminal;
}): Promise<Schedule | null> => {
  try {
    const response = await getSchedule(terminal, mate, date);
    return response.schedule;
  } catch (error) {
    console.warn("Failed to load alert schedule preview", error);
    return null;
  }
};

// rule editor
const AlertRuleEditor = ({
  disabled,
  mate,
  onChange,
  onDone,
  onRemove,
  rule,
  terminal,
}: AlertRuleEditorProps): ReactElement => {
  const [schedules, setSchedules] = useState<Record<string, Schedule | null>>(
    {}
  );
  const [isLoadingSchedules, setLoadingSchedules] = useState<boolean>(false);
  const [isCustomDaysOpen, setCustomDaysOpen] = useState<boolean>(false);
  const departureOptions: DepartureOption[] = [
    { label: terminal.name, terminalIds: [terminal.id], value: terminal.id },
    { label: mate.name, terminalIds: [mate.id], value: mate.id },
    {
      label: "Both",
      terminalIds: [terminal.id, mate.id],
      value: "both",
    },
  ];
  const previewDate = useMemo(
    () => getPreviewDate(rule.daysOfWeek),
    [rule.daysOfWeek.join(":")]
  );
  const dayPreset = getDayPreset(rule.daysOfWeek);
  const showCustomDays = dayPreset === "custom" || isCustomDaysOpen;
  // combined sailing rows
  const sailingRows = useMemo((): SailingRow[] => {
    const departuresByTime = new Map<number, Set<string>>();
    // selected terminal scan
    rule.terminalIds.forEach((terminalId) => {
      const slots = schedules[terminalId]?.slots ?? [];
      // slot grouping
      slots.forEach((slot) => {
        const terminalIdsForTime =
          departuresByTime.get(slot.time) ?? new Set<string>();
        terminalIdsForTime.add(terminalId);
        departuresByTime.set(slot.time, terminalIdsForTime);
      });
    });
    return Array.from(departuresByTime.entries())
      .map(([time, terminalIdsForTime]) => {
        return {
          key: String(time),
          terminalIds: Array.from(terminalIdsForTime),
          time,
        };
      })
      .sort((left, right) => left.time - right.time);
  }, [rule.terminalIds.join(":"), schedules]);

  // load preview schedules
  useEffect(() => {
    let isCancelled = false;
    const loadSchedules = async (): Promise<void> => {
      setLoadingSchedules(true);
      const entries = await Promise.all(
        rule.terminalIds.map(async (terminalId) => {
          const departingTerminal =
            terminalId === terminal.id ? terminal : mate;
          const arrivingTerminal = terminalId === terminal.id ? mate : terminal;
          const schedule = await getScheduleForDirection({
            date: previewDate,
            mate: arrivingTerminal,
            terminal: departingTerminal,
          });
          return [terminalId, schedule] as const;
        })
      );
      // stale load guard
      if (!isCancelled) {
        setSchedules(Object.fromEntries(entries));
        setLoadingSchedules(false);
      }
    };
    loadSchedules();
    return () => {
      isCancelled = true;
    };
  }, [mate, previewDate.toISODate(), rule.terminalIds.join(":"), terminal]);

  // departure radio change
  const setDepartureOption = (terminalIds: string[]): void => {
    onChange({
      ...rule,
      terminalIds,
    });
  };

  // day preset change
  const setDayPreset = (preset: DayPreset): void => {
    const isCustomPreset = preset === "custom";
    setCustomDaysOpen(isCustomPreset);
    // custom reveal guard
    if (isCustomPreset) {
      return;
    }
    onChange({
      ...rule,
      daysOfWeek: getDaysForPreset(preset, rule.daysOfWeek),
    });
  };

  // custom day toggle
  const toggleDay = (day: number): void => {
    const isSelected = rule.daysOfWeek.includes(day);
    const daysOfWeek = isSelected
      ? without(rule.daysOfWeek, day)
      : [...rule.daysOfWeek, day];
    // empty days guard
    if (daysOfWeek.length === 0) {
      return;
    }
    onChange({ ...rule, daysOfWeek: normalizeAlertRuleDays(daysOfWeek) });
  };

  // sailing click
  const selectSailing = (time: number): void => {
    const selectedTime = getAlertRuleTimeFromDate(DateTime.fromSeconds(time));
    // reset selection guard
    if (!rule.startTime || rule.endTime) {
      onChange({ ...rule, endTime: "", startTime: selectedTime });
      return;
    }
    const startSeconds = getAlertRuleTimeSeconds(rule.startTime);
    const selectedSeconds = getAlertRuleTimeSeconds(selectedTime);
    // ordered window guard
    if (selectedSeconds < startSeconds) {
      onChange({ ...rule, endTime: rule.startTime, startTime: selectedTime });
      return;
    }
    onChange({ ...rule, endTime: selectedTime });
  };

  // selected sailing guard
  const isTimeSelected = (time: number): boolean => {
    // incomplete window guard
    if (!rule.startTime) {
      return false;
    }
    const slotTime = getAlertRuleTimeFromDate(DateTime.fromSeconds(time));
    const slotSeconds = getAlertRuleTimeSeconds(slotTime);
    const startSeconds = getAlertRuleTimeSeconds(rule.startTime);
    const endSeconds = rule.endTime
      ? getAlertRuleTimeSeconds(rule.endTime)
      : startSeconds;
    return slotSeconds >= startSeconds && slotSeconds <= endSeconds;
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-gray-darkest dark:text-white">
            Alert window
          </p>
          <p className="mt-1 text-xs text-gray-dark dark:text-[#b8d5de]">
            Pick the first and last sailing you want covered.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="text-xs font-bold text-blue-dark dark:text-[#6fb8c8]"
            disabled={disabled}
            onClick={onDone}
            type="button"
          >
            Done
          </button>
          <button
            className="text-xs font-bold text-stale-light dark:text-[#ffb3b0]"
            disabled={disabled}
            onClick={onRemove}
            type="button"
          >
            Remove
          </button>
        </div>
      </div>

      <label className="mt-4 block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-blue-dark dark:text-[#6fb8c8]">
          Nickname
        </span>
        <input
          className="field my-0 w-full"
          disabled={disabled}
          maxLength={48}
          onChange={(event) =>
            onChange({ ...rule, nickname: event.target.value })
          }
          placeholder="Morning commute"
          value={rule.nickname}
        />
      </label>

      <div className="mt-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-blue-dark dark:text-[#6fb8c8]">
          Departing from
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {departureOptions.map((option) => {
            const isSelected =
              option.terminalIds.length === rule.terminalIds.length &&
              option.terminalIds.every((terminalId) => {
                return rule.terminalIds.includes(terminalId);
              });
            return (
              <button
                aria-pressed={isSelected}
                className={clsx(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-bold transition",
                  isSelected
                    ? "border-green-dark bg-green-dark text-white dark:border-green-light dark:bg-green-light dark:text-blue-darkest"
                    : "border-gray-300 bg-white text-gray-dark dark:border-white/20 dark:bg-transparent dark:text-[#d8e8ec]"
                )}
                disabled={disabled}
                key={option.value}
                onClick={() => setDepartureOption(option.terminalIds)}
                type="button"
              >
                <span
                  className={clsx(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    isSelected
                      ? "border-white bg-white text-green-dark dark:border-blue-darkest dark:bg-blue-darkest dark:text-green-light"
                      : "border-gray-400 bg-white dark:border-white/30 dark:bg-transparent"
                  )}
                >
                  {isSelected && (
                    <span className="h-2 w-2 rounded-full bg-current" />
                  )}
                </span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-blue-dark dark:text-[#6fb8c8]">
          Days
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            ["weekdays", "Weekdays"],
            ["weekends", "Weekends"],
            ["every-day", "Every day"],
            ["custom", "Custom"],
          ].map(([preset, label]) => {
            const isSelected =
              preset === "custom"
                ? showCustomDays
                : !showCustomDays && dayPreset === preset;
            return (
              <button
                aria-pressed={isSelected}
                className={clsx(
                  "rounded-full border px-3 py-1.5 text-sm font-bold transition",
                  isSelected
                    ? "border-blue-dark bg-blue-dark text-white dark:border-[#6fb8c8] dark:bg-[#6fb8c8] dark:text-blue-darkest"
                    : "border-gray-300 bg-white text-gray-dark dark:border-white/20 dark:bg-transparent dark:text-[#d8e8ec]"
                )}
                disabled={disabled}
                key={preset}
                onClick={() => setDayPreset(preset as DayPreset)}
                type="button"
              >
                {label}
              </button>
            );
          })}
        </div>
        {showCustomDays && (
          <div className="mt-2 flex flex-wrap gap-2">
            {DAY_OPTIONS.map(({ day, label }) => {
              const isSelected = rule.daysOfWeek.includes(day);
              return (
                <button
                  aria-pressed={isSelected}
                  className={clsx(
                    "h-9 w-9 rounded-full border text-sm font-bold transition",
                    isSelected
                      ? "border-green-dark bg-green-dark text-white dark:border-green-light dark:bg-green-light dark:text-blue-darkest"
                      : "border-gray-300 bg-white text-gray-dark dark:border-white/20 dark:bg-transparent dark:text-[#d8e8ec]"
                  )}
                  disabled={disabled}
                  key={day}
                  onClick={() => toggleDay(day)}
                  type="button"
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-blue-dark dark:text-[#6fb8c8]">
          Sailings
        </p>
        <p className="mb-3 text-xs text-gray-dark dark:text-[#b8d5de]">
          Showing {previewDate.toFormat("cccc")} sailings. Tap one sailing to
          start, then another to end.
        </p>
        {isLoadingSchedules && (
          <SkeletonGroup
            className="mb-3 flex items-center gap-3 rounded-xl bg-blue-dark/5 px-3 py-2 text-sm font-semibold text-gray-dark dark:bg-white/[0.04] dark:text-[#b8d5de]"
            label="Loading sailings"
          >
            <Skeleton className="h-4 w-20 shrink-0" variant="text" />
            <span>Loading sailings…</span>
          </SkeletonGroup>
        )}
        <div>
          <div className="mb-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs font-bold uppercase tracking-[0.14em] text-blue-dark dark:text-[#6fb8c8]">
            <span className="text-left">{terminal.name}</span>
            <span className="w-20" />
            <span className="text-right">{mate.name}</span>
          </div>
          {sailingRows.length === 0 ? (
            <p className="text-sm text-gray-dark dark:text-[#b8d5de]">
              No preview sailings available.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {sailingRows.map(({ key, terminalIds: rowTerminalIds, time }) => {
                const isSelected = isTimeSelected(time);
                const hasLeftDeparture = rowTerminalIds.includes(terminal.id);
                const hasRightDeparture = rowTerminalIds.includes(mate.id);
                const departureNames = rowTerminalIds
                  .map((terminalId) => {
                    return terminalId === terminal.id
                      ? terminal.name
                      : mate.name;
                  })
                  .join(" and ");
                const label = DateTime.fromSeconds(time).toFormat("h:mm a");
                return (
                  <button
                    aria-label={`${label} from ${departureNames}`}
                    aria-pressed={isSelected}
                    className={clsx(
                      "grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg border px-3 py-2 text-sm font-bold transition",
                      isSelected
                        ? "border-green-dark bg-green-dark text-white dark:border-green-light dark:bg-green-light dark:text-blue-darkest"
                        : "border-gray-200 bg-white text-gray-dark hover:border-blue-dark dark:border-white/10 dark:bg-[#00202a] dark:text-[#d8e8ec] dark:hover:border-[#6fb8c8]"
                    )}
                    disabled={disabled}
                    key={key}
                    onClick={() => selectSailing(time)}
                    type="button"
                  >
                    <span className="flex justify-start">
                      {hasLeftDeparture && (
                        <ArrowRightIcon className="h-5 w-5" />
                      )}
                    </span>
                    <span className="w-20 text-center">{label}</span>
                    <span className="flex justify-end">
                      {hasRightDeparture && (
                        <ArrowLeftIcon className="h-5 w-5" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {isDraftRuleComplete(rule) && (
        <p className="mt-4 rounded-lg bg-green-dark/10 p-2 text-sm text-green-dark dark:bg-green-light/10 dark:text-green-light">
          {getDaysLabel(rule.daysOfWeek)} · {getTimeLabel(rule.startTime)}
          {rule.endTime && rule.endTime !== rule.startTime
            ? ` through ${getTimeLabel(rule.endTime)}`
            : ""}{" "}
          sailings
        </p>
      )}
    </div>
  );
};

interface AlertRuleSummaryProps {
  disabled: boolean;
  mate: Terminal;
  onEdit: () => void;
  onToggleEnabled: () => void;
  rule: DraftAlertRule;
  terminal: Terminal;
}

const AlertRuleSummary = ({
  disabled,
  mate,
  onEdit,
  onToggleEnabled,
  rule,
  terminal,
}: AlertRuleSummaryProps): ReactElement => {
  let departureLabel = `From ${mate.name}`;
  if (rule.terminalIds.length === 2) {
    departureLabel = "Both directions";
  } else if (rule.terminalIds.includes(terminal.id)) {
    departureLabel = `From ${terminal.name}`;
  }
  const timeLabel = getTimeLabel(rule.startTime);
  const windowLabel =
    rule.endTime && rule.endTime !== rule.startTime
      ? `${timeLabel}–${getTimeLabel(rule.endTime)}`
      : timeLabel;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-gray-darkest dark:text-white">
          {rule.nickname || "Alert window"}
        </p>
        <p className="mt-1 text-xs text-gray-dark dark:text-[#b8d5de]">
          {getDaysLabel(rule.daysOfWeek)} · {windowLabel} · {departureLabel}
        </p>
      </div>
      <button
        className="text-xs font-bold text-blue-dark dark:text-[#6fb8c8]"
        disabled={disabled}
        onClick={onEdit}
        type="button"
      >
        Edit
      </button>
      <button
        aria-checked={rule.enabled}
        aria-label={`Turn ${rule.nickname || "alert window"} ${
          rule.enabled ? "off" : "on"
        }`}
        className={clsx(
          "relative h-7 w-12 shrink-0 rounded-full transition",
          rule.enabled
            ? "bg-green-dark dark:bg-green-light"
            : "bg-gray-300 dark:bg-white/20"
        )}
        disabled={disabled}
        onClick={onToggleEnabled}
        role="switch"
        type="button"
      >
        <span
          className={clsx(
            "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition",
            rule.enabled ? "left-6" : "left-1"
          )}
        />
      </button>
    </div>
  );
};

export const AlertSubscription = ({
  mate,
  setRoute,
  terminal,
}: Props): ReactElement => {
  const device = useDevice();
  const location = useLocation();
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();
  const { terminals } = useTerminals();
  const [
    { alertRules, isUserLoading, user, userError },
    { refreshUser, updateUser },
  ] = useUser();
  const [isRouteOpen, setRouteOpen] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<Error | null>(null);
  const terminalIds = [terminal.id, mate.id];
  const routeKey = getRouteSubscriptionKey(terminalIds);
  const routeRules = getRouteRules(alertRules, terminalIds);
  const initialChannels = getInitialRuleChannels(routeRules, []);
  const initialMode: ScheduleMode = routeRules.some((rule) => {
    return !isFullDayAlertRule(rule);
  })
    ? "custom"
    : "always";
  const initialDraftRules = getDraftRules(routeRules);
  const isSubscribed = initialChannels.length > 0;
  const [selectedChannels, setSelectedChannels] =
    useState<AlertSubscriptionChannel[]>(initialChannels);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(initialMode);
  const [draftRules, setDraftRules] =
    useState<DraftAlertRule[]>(initialDraftRules);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [isSaving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [wasSaved, setWasSaved] = useState<boolean>(false);
  const customRuleError =
    scheduleMode === "custom" ? getCustomScheduleSaveError(draftRules) : null;
  const hasChanges =
    !areChannelsEqual(selectedChannels, initialChannels) ||
    scheduleMode !== initialMode ||
    serializeDraftRules(draftRules) !== serializeDraftRules(initialDraftRules);
  const terminalPairOptions = getTerminalPairOptions(terminals);
  const hasConfiguredAlerts = (alertRules?.length ?? 0) > 0;
  const pairName = `${terminal.name} to ${mate.name}`;
  const pairShortName = `${terminal.abbreviation} → ${mate.abbreviation}`;
  const titleText = `${pairName} Alerts`;

  // auth redirect
  useEffect(() => {
    const login = async (): Promise<void> => {
      // authenticated guard
      if (isLoading || isAuthenticated) {
        return;
      }
      const redirectPath = `${location.pathname}${location.search}`;
      const loginOptions = {
        appState: { redirectPath },
        authorizationParams: {
          redirect_uri: getConfiguredAuth0RedirectUri(),
        },
      };
      try {
        // native browser login
        if (device?.isNativeMobile) {
          await loginWithRedirect({
            ...loginOptions,
            openUrl: async (url) => {
              const { Browser } = await import("@capacitor/browser");
              await Browser.open({ url });
            },
          });
          return;
        }
        await loginWithRedirect(loginOptions);
      } catch (error) {
        // login failure guard
        setLoginError(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    };
    login();
  }, [
    device?.isNativeMobile,
    isAuthenticated,
    isLoading,
    location.pathname,
    location.search,
    loginWithRedirect,
  ]);

  // sync saved state
  useEffect(() => {
    setSaveError(null);
    setSelectedChannels(initialChannels);
    setScheduleMode(initialMode);
    setDraftRules(initialDraftRules);
    setEditingRuleId(null);
  }, [
    routeKey,
    initialChannels.join(":"),
    initialMode,
    serializeDraftRules(initialDraftRules),
  ]);

  // auth loading guard
  if (isLoading || (!isAuthenticated && !loginError)) {
    return <AlertSubscriptionLoadingState />;
  }

  // channel toggle
  const toggleChannel = (channel: AlertSubscriptionChannel): void => {
    setSaveError(null);
    setWasSaved(false);
    setSelectedChannels((currentChannels) => {
      // selected guard
      if (currentChannels.includes(channel)) {
        return without(currentChannels, channel);
      }
      return [...currentChannels, channel];
    });
  };

  // default draft rule
  const createDefaultDraftRule = (): DraftAlertRule => {
    return {
      daysOfWeek: WEEKDAY_DAYS,
      endTime: "",
      id: createRuleId(),
      enabled: true,
      nickname: "",
      routeKey,
      startTime: "",
      terminalIds: [terminal.id],
    };
  };

  // schedule mode change
  const changeScheduleMode = (mode: ScheduleMode): void => {
    setSaveError(null);
    setWasSaved(false);
    setScheduleMode(mode);
    // first custom rule guard
    if (mode === "custom" && draftRules.length === 0) {
      const rule = createDefaultDraftRule();
      setDraftRules([rule]);
      setEditingRuleId(rule.id);
    }
  };

  // draft rule update
  const updateDraftRule = (nextRule: DraftAlertRule): void => {
    setSaveError(null);
    setWasSaved(false);
    setDraftRules((currentRules) => {
      return currentRules.map((rule) => {
        // target rule guard
        if (rule.id === nextRule.id) {
          return nextRule;
        }
        return rule;
      });
    });
  };

  // add draft rule
  const addDraftRule = (): void => {
    setSaveError(null);
    setWasSaved(false);
    const rule = createDefaultDraftRule();
    setDraftRules((currentRules) => [...currentRules, rule]);
    setEditingRuleId(rule.id);
  };

  // remove draft rule
  const removeDraftRule = (ruleId: string): void => {
    setSaveError(null);
    setWasSaved(false);
    setDraftRules((currentRules) => {
      return currentRules.filter((rule) => rule.id !== ruleId);
    });
    setEditingRuleId((currentRuleId) => {
      return currentRuleId === ruleId ? null : currentRuleId;
    });
  };

  // saved rule builder
  const getNextRouteRules = (
    channels: AlertSubscriptionChannel[]
  ): AlertRule[] => {
    // unsubscribed guard
    if (channels.length === 0) {
      return [];
    }
    // all-day route guard
    if (scheduleMode === "always") {
      return [
        createFullDayAlertRule({
          channels,
          id: routeRules.find(isFullDayAlertRule)?.id ?? createRuleId(),
          routeKey,
          terminalIds,
        }),
      ];
    }
    return draftRules.filter(isDraftRuleComplete).map((rule) => {
      return { ...rule, channels, endTime: getDraftRuleEndTime(rule) };
    });
  };

  // save subscription
  const saveSubscription = async ({
    channels = selectedChannels,
    shouldValidateCustom = true,
  }: {
    channels?: AlertSubscriptionChannel[];
    shouldValidateCustom?: boolean;
  } = {}): Promise<void> => {
    const nextSaveError = customRuleError;
    // custom validation guard
    if (shouldValidateCustom && nextSaveError) {
      setSaveError(nextSaveError);
      setWasSaved(false);
      return;
    }
    // Start the permission request directly in the Save button's user gesture.
    // Waiting for the account request first causes browsers to suppress it.
    const notificationPermission =
      channels.length > 0
        ? requestNotificationPermission()
        : Promise.resolve(false);
    setSaveError(null);
    setSaving(true);
    const nextAlertRules = (alertRules ?? []).filter((rule) => {
      // keep unrelated and one-time rules
      return !isRuleForRoute(rule, terminalIds) || isOneTimeAlertRule(rule);
    });
    nextAlertRules.push(...getNextRouteRules(channels));
    try {
      const permissionGranted = await notificationPermission;
      await updateUser({
        app_metadata: {
          alertRules: nextAlertRules,
        },
      });
      if (permissionGranted) {
        requestPushInitialization();
      }
      setWasSaved(true);
      setEditingRuleId(null);
    } finally {
      setSaving(false);
    }
  };

  // unsubscribe route
  const unsubscribe = async (): Promise<void> => {
    setSelectedChannels([]);
    await saveSubscription({ channels: [], shouldValidateCustom: false });
  };

  // blocked state renderer
  const renderBlockedState = ({
    action,
    message,
    title,
  }: {
    action?: ReactNode;
    message: string;
    title: string;
  }): ReactElement => (
    <>
      <Header>
        <span className="text-center flex-1">Alerts</span>
      </Header>
      <main className="flex-grow overflow-y-scroll scrolling-touch bg-day-normal-light px-4 py-8 text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
        <section className="mx-auto w-full max-w-6xl rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5 shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]">
          <h1 className="text-2xl font-bold text-gray-darkest dark:text-white">
            {title}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-dark dark:text-[#b8d5de]">
            {message}
          </p>
          {action && <div className="mt-4">{action}</div>}
        </section>
      </main>
    </>
  );

  // login error guard
  if (!isAuthenticated) {
    return renderBlockedState({
      action: (
        <button
          className="button button-invert"
          onClick={() => window.location.reload()}
          type="button"
        >
          Try logging in again
        </button>
      ),
      message: loginError?.message ?? "Login could not be started.",
      title: "Login required",
    });
  }

  // user loading guard
  if (!user && isUserLoading) {
    return <AlertSubscriptionLoadingState />;
  }

  // user error guard
  if (!user) {
    return renderBlockedState({
      action: (
        <button
          className="button button-invert"
          onClick={() => refreshUser()}
          type="button"
        >
          Retry account sync
        </button>
      ),
      message:
        userError?.message ??
        "Your login succeeded, but your account preferences could not be loaded.",
      title: "Account preferences unavailable",
    });
  }

  return (
    <>
      <Header>
        <div className="min-w-0 flex-1" />
        <div className="min-w-0 text-center">
          <HeaderDropdown
            ariaLabel="Expand terminal pairs"
            getKey={(option) => {
              // pair option key
              return option.key;
            }}
            getLabel={(option) => {
              // pair option label
              return option.label;
            }}
            getShortLabel={(option) => {
              // pair option short label
              return option.shortLabel;
            }}
            isOpen={isRouteOpen}
            onSelect={(event, option) => {
              event.preventDefault();
              setRouteOpen(false);
              setRoute(getSlug(option.terminal.id), getSlug(option.mate.id));
            }}
            options={terminalPairOptions}
            selectedLabel={pairName}
            selectedShortLabel={pairShortName}
            setOpen={setRouteOpen}
          />
        </div>
        <span className="ml-2 shrink-0">Alerts</span>
        <div className="min-w-0 flex-1" />
      </Header>
      <main className="flex-grow overflow-y-scroll scrolling-touch bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
        <section className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 pb-24 sm:px-6">
          <div className="rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5 shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-green-dark text-white dark:bg-green-light dark:text-blue-darkest">
                <BellIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-2xs font-bold uppercase tracking-[0.16em] text-blue-dark dark:text-[#6fb8c8]">
                  {isSubscribed ? "Edit alerts" : "Set up alerts"}
                </p>
                <h1 className="mt-1 text-2xl font-bold leading-tight text-gray-darkest dark:text-white">
                  {titleText}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-gray-dark dark:text-[#b8d5de]">
                  Choose exactly which push notifications you want for{" "}
                  {pairName}.
                </p>
              </div>
            </div>
          </div>
          <AppTeaser />
          <NotificationPermissionWarning hasAlerts={hasConfiguredAlerts} />

          <div className="rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-4 shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]">
            <h2 className="mb-3 text-lg font-bold text-gray-darkest dark:text-white">
              Alert channels
            </h2>
            <div className="flex flex-col gap-3">
              {ALERT_SUBSCRIPTION_CHANNELS.map(({ description, id, label }) => {
                const isSelected = selectedChannels.includes(id);
                return (
                  <button
                    aria-pressed={isSelected}
                    className={clsx(
                      "flex items-start gap-3 rounded-xl border p-3 text-left transition",
                      isSelected
                        ? "border-green-dark bg-green-dark/10 text-green-dark dark:border-green-light dark:bg-green-light/10 dark:text-green-light"
                        : "border-gray-200 bg-gray-50 text-gray-dark hover:border-blue-dark dark:border-white/10 dark:bg-white/[0.03] dark:text-[#d8e8ec] dark:hover:border-[#6fb8c8]"
                    )}
                    disabled={isSaving}
                    key={id}
                    onClick={() => toggleChannel(id)}
                    type="button"
                  >
                    <span
                      className={clsx(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                        isSelected
                          ? "border-green-dark bg-green-dark text-white dark:border-green-light dark:bg-green-light dark:text-blue-darkest"
                          : "border-gray-300 bg-white dark:border-white/20 dark:bg-transparent"
                      )}
                    >
                      {isSelected && <CheckIcon className="h-3 w-3" />}
                    </span>
                    <span>
                      <span className="block font-bold">{label}</span>
                      <span className="mt-1 block text-sm opacity-80">
                        {description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-4 shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]">
            <h2 className="text-lg font-bold text-gray-darkest dark:text-white">
              Alert schedule
            </h2>
            <p className="mt-1 text-sm text-gray-dark dark:text-[#b8d5de]">
              Filter alerts to sailings you actually care about.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {[
                [
                  "always",
                  "Any time",
                  "Send alerts whenever this route has news.",
                ],
                [
                  "custom",
                  "Custom sailing windows",
                  "Send alerts only for selected sailing ranges.",
                ],
              ].map(([mode, label, description]) => {
                const isSelected = scheduleMode === mode;
                return (
                  <button
                    aria-pressed={isSelected}
                    className={clsx(
                      "rounded-xl border p-3 text-left transition",
                      isSelected
                        ? "border-green-dark bg-green-dark/10 text-green-dark dark:border-green-light dark:bg-green-light/10 dark:text-green-light"
                        : "border-gray-200 bg-gray-50 text-gray-dark hover:border-blue-dark dark:border-white/10 dark:bg-white/[0.03] dark:text-[#d8e8ec] dark:hover:border-[#6fb8c8]"
                    )}
                    disabled={isSaving}
                    key={mode}
                    onClick={() => changeScheduleMode(mode as ScheduleMode)}
                    type="button"
                  >
                    <span className="block font-bold">{label}</span>
                    <span className="mt-1 block text-sm opacity-80">
                      {description}
                    </span>
                  </button>
                );
              })}
            </div>

            {scheduleMode === "custom" && (
              <div className="mt-4 flex flex-col gap-3">
                <p className="text-sm font-semibold text-gray-dark dark:text-[#b8d5de]">
                  Enable only the windows you want active, or edit one window at
                  a time.
                </p>
                {draftRules.map((rule) =>
                  editingRuleId === rule.id ? (
                    <AlertRuleEditor
                      disabled={isSaving}
                      key={rule.id}
                      mate={mate}
                      onChange={updateDraftRule}
                      onDone={() => setEditingRuleId(null)}
                      onRemove={() => removeDraftRule(rule.id)}
                      rule={rule}
                      terminal={terminal}
                    />
                  ) : (
                    <AlertRuleSummary
                      disabled={isSaving}
                      key={rule.id}
                      mate={mate}
                      onEdit={() => setEditingRuleId(rule.id)}
                      onToggleEnabled={() =>
                        updateDraftRule({ ...rule, enabled: !rule.enabled })
                      }
                      rule={rule}
                      terminal={terminal}
                    />
                  )
                )}
                <button
                  className="button border-blue-dark text-blue-dark hover:bg-blue-dark hover:text-white dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-green-dark"
                  disabled={isSaving}
                  onClick={addDraftRule}
                  type="button"
                >
                  Add another window
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-4 shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]">
            {wasSaved && (
              <p className="rounded-xl bg-green-dark/10 px-3 py-2 text-sm font-bold text-green-dark dark:bg-green-light/10 dark:text-green-light">
                Alerts saved.
              </p>
            )}
            {saveError && (
              <p className="rounded-xl bg-day-normal-light px-3 py-2 text-sm text-gray-dark dark:bg-blue-dark dark:text-[#b8d5de]">
                {saveError}
              </p>
            )}
            <button
              className={clsx("button button-primary", {
                "button-disabled": isSaving || !hasChanges,
              })}
              disabled={isSaving || !hasChanges}
              onClick={() => saveSubscription()}
              type="button"
            >
              {isSaving ? "Saving..." : "Save alerts"}
            </button>
            {isSubscribed && (
              <button
                className="button button-outline border-stale-light text-stale-light dark:border-[#ffb3b0] dark:text-[#ffb3b0]"
                disabled={isSaving}
                onClick={() => unsubscribe()}
                type="button"
              >
                <div className="button-icon">
                  <BellSlashIcon />
                </div>
                <span className="button-label">Turn off route alerts</span>
              </button>
            )}
            <Link
              className="link self-center text-sm font-bold text-blue-dark dark:text-[#6fb8c8]"
              to="/account#subscriptions"
            >
              View all saved alerts
            </Link>
          </div>
        </section>
      </main>
    </>
  );
};
