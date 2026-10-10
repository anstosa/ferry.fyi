import clsx from "clsx";
import { DateTime } from "luxon";
import React, { type ReactElement } from "react";
import { Level } from "shared/contracts/bulletins";
import type { Schedule, Slot } from "shared/contracts/schedules";
import type { PublicSsrTerminal } from "shared/contracts/ssr";
import { isSuppressedBulletin, isWaitTimeBulletin } from "shared/lib/bulletins";
import { getRecommendationServiceDate } from "shared/lib/sailingRecommendationRevision";
import { getStaticPublicSsrTerminalSlug } from "shared/lib/ssrRouteMatch";

import { RoutePageIntro } from "~/components/RoutePageIntro";
import { RouteQuickLinks } from "~/components/RouteQuickLinks";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";
import AlertsIcon from "~/static/images/icons/solid/bell-exclamation.svg";
import CamerasIcon from "~/static/images/icons/solid/cctv.svg";
import FaresIcon from "~/static/images/icons/solid/dollar-sign.svg";
import TerminalIcon from "~/static/images/icons/solid/garage-car.svg";
import NavigationIcon from "~/static/images/icons/solid/location-arrow.svg";
import MapIcon from "~/static/images/icons/solid/map.svg";
import { getCurrentSlot } from "~/views/Schedule/nowDivider";

type OverviewTerminal = Pick<
  PublicSsrTerminal,
  "abbreviation" | "bulletins" | "id" | "name" | "waitTimes"
> & { mates?: readonly Pick<PublicSsrTerminal, "id">[] };

interface Props {
  inset?: boolean;
  mate: OverviewTerminal;
  navigationPath?: string;
  reportsLoading?: boolean;
  schedule: Schedule | null;
  scheduleLoading?: boolean;
  selectedDate: string;
  terminal: OverviewTerminal;
  time: DateTime;
}

// preserve report age rather than treating the page clock as source freshness
const SourceTime = ({ value }: { value: number }): ReactElement => {
  // reject missing timestamps before luxon parses the source value
  if (!Number.isFinite(value) || value <= 0) {
    return <span>Source update time unavailable</span>;
  }
  const reported = DateTime.fromSeconds(value, {
    zone: "America/Los_Angeles",
  });
  // missing source timestamps must not become january 1970 reports
  if (!reported.isValid) {
    return <span>Source update time unavailable</span>;
  }
  return (
    <time dateTime={reported.toISO() ?? undefined}>
      {reported.toFormat("MMM d, yyyy · h:mm a ZZZZ")}
    </time>
  );
};

// lead both browser and initial html with the rider's wait-time question
export const ScheduleOverview = ({
  inset = true,
  mate,
  navigationPath,
  reportsLoading = false,
  schedule,
  scheduleLoading = false,
  selectedDate,
  terminal,
  time,
}: Props): ReactElement => {
  const isCurrentDay =
    selectedDate === getRecommendationServiceDate(time.toSeconds());
  const date = DateTime.fromISO(selectedDate, {
    zone: "America/Los_Angeles",
  });
  const terminalSlug = getStaticPublicSsrTerminalSlug(terminal.id);
  const mateSlug = getStaticPublicSsrTerminalSlug(mate.id);
  const routePath = `/${terminalSlug}${terminal.mates?.length === 1 ? "" : `/${mateSlug}`}`;
  // restrict alerts to this departure feed and a known route or terminal-wide scope
  const waitAlert = terminal.bulletins
    .filter((bulletin) => {
      const routeTerminals = bulletin.routePrefix.split("/");
      return (
        bulletin.terminalId === terminal.id &&
        bulletin.level !== Level.LOW &&
        !isSuppressedBulletin(bulletin) &&
        isWaitTimeBulletin(bulletin) &&
        (bulletin.routePrefix === "All" ||
          (routeTerminals.includes(terminal.abbreviation) &&
            routeTerminals.includes(mate.abbreviation)))
      );
    })
    // show the newest source alert without extracting a synthetic queue duration
    .sort((left, right) => right.date - left.date)[0];
  let nextSlot: Slot | null | undefined = null;
  // use current departure state only for the current pacific service day
  if (schedule) {
    nextSlot = isCurrentDay
      ? getCurrentSlot(schedule.slots, time)
      : schedule.slots[0];
  }
  const isCancelled = Boolean(
    nextSlot?.crossing?.isCancelled || nextSlot?.cancellationReason
  );
  const departure = nextSlot
    ? DateTime.fromSeconds(nextSlot.time, { zone: "America/Los_Angeles" })
    : null;

  // match the bottom navigation's directional paths and selected-date context
  const toolPath = (view: string): string => {
    const path =
      view === "terminal"
        ? `/${terminalSlug}/terminal`
        : `${routePath}/${view}`;
    return isCurrentDay
      ? path
      : `${path}?date=${encodeURIComponent(selectedDate)}`;
  };
  const tools = [
    ...(isCurrentDay
      ? [
          {
            Icon: NavigationIcon,
            label: "What boat will I make?",
            path: navigationPath ?? toolPath("navigation"),
          },
        ]
      : []),
    {
      Icon: CamerasIcon,
      label: "Ferry line cameras",
      path: toolPath("cameras"),
    },
    { Icon: TerminalIcon, label: "Terminal info", path: toolPath("terminal") },
    { Icon: MapIcon, label: "Route Map", path: toolPath("map") },
    {
      Icon: FaresIcon,
      label: "How much does it cost?",
      path: toolPath("fare"),
    },
    { Icon: AlertsIcon, label: "WSF Alerts", path: toolPath("alerts") },
  ];

  return (
    <section
      className={clsx(
        "border-b border-black/10 bg-gray-50 dark:border-white/10 dark:bg-blue-darkest",
        inset && "p-4"
      )}
    >
      <RoutePageIntro
        title={`${terminal.name} to ${mate.name} ferry wait times & schedule`}
        description={
          <time dateTime={selectedDate}>{date.toFormat("LLLL d, yyyy")}</time>
        }
      />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <section
          aria-labelledby="schedule-wait-heading"
          className="min-w-0 rounded-xl border border-white/15 bg-black p-3 text-white"
        >
          <h2
            id="schedule-wait-heading"
            className="text-xs font-semibold text-gray-300"
          >
            Vehicle wait
          </h2>
          {/* retain unknown states rather than inventing a zero-minute wait */}
          {!isCurrentDay && (
            <p className="mt-1 text-base font-bold leading-snug">
              Wait time not forecast
            </p>
          )}
          {isCurrentDay && reportsLoading && (
            <SkeletonGroup label="Loading WSF wait reports" className="mt-2">
              <Skeleton
                className="h-5 w-24 max-w-full bg-white/20"
                variant="text"
              />
            </SkeletonGroup>
          )}
          {isCurrentDay && !reportsLoading && !waitAlert && (
            <p className="mt-1 text-base font-bold leading-snug">
              None reported
            </p>
          )}
          {/* preserve the source report and its actual terminal context */}
          {isCurrentDay && !reportsLoading && waitAlert && (
            <>
              <p className="mt-1 text-base font-bold leading-snug">
                {waitAlert.title}
              </p>
              <p className="mt-1 whitespace-pre-line text-xs leading-snug">
                {waitAlert.bodyText}
              </p>
              <p className="mt-2 text-xs leading-snug text-gray-300">
                {waitAlert.routePrefix === "All"
                  ? "WSF terminal-wide wait alert"
                  : "Latest WSF route wait alert"}
                {" · "}
                <SourceTime value={waitAlert.date} />
              </p>
            </>
          )}
        </section>
        <section
          aria-labelledby="schedule-next-heading"
          className="min-w-0 rounded-xl border border-white/15 bg-black p-3 text-white"
        >
          <h2
            id="schedule-next-heading"
            className="text-xs font-semibold text-gray-300"
          >
            {isCurrentDay ? "Next scheduled" : "First listed sailing"}
          </h2>
          {scheduleLoading ? (
            <SkeletonGroup
              label="Loading next scheduled sailing"
              className="mt-2"
            >
              <Skeleton
                className="h-7 w-28 max-w-full bg-white/20"
                variant="text"
              />
            </SkeletonGroup>
          ) : null}
          {!scheduleLoading && departure && nextSlot ? (
            <>
              <p className="mt-1 text-xl font-bold tabular-nums leading-tight sm:text-2xl">
                <time dateTime={departure.toISO() ?? undefined}>
                  {departure.toFormat("h:mm a")}
                </time>
              </p>
              {isCancelled && (
                <p className="mt-1 text-xs font-semibold text-red-200">
                  Cancelled
                </p>
              )}
            </>
          ) : null}
          {!scheduleLoading && (!departure || !nextSlot) ? (
            <p className="mt-1 text-sm">
              {schedule
                ? "No remaining sailings listed."
                : "Departure data unavailable."}
            </p>
          ) : null}
        </section>
      </div>
      <RouteQuickLinks links={tools} />
    </section>
  );
};
