import clsx from "clsx";
import { DateTime } from "luxon";
import React, { type ReactElement, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Schedule } from "shared/contracts/schedules";
import type {
  PublicSsrSnapshot,
  PublicSsrSourceKey,
  PublicSsrSourceOutcome,
} from "shared/contracts/ssr";
import type { Terminal } from "shared/contracts/terminals";
import { findWhere } from "shared/lib/arrays";
import { isNull } from "shared/lib/identity";
import { getSeoMetadata } from "shared/lib/seo";

import { SeoHelmet } from "~/components/SeoHelmet";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";
import { useAppRenderContext } from "~/lib/renderContext";
import { getSchedule, requireScheduleResponse } from "~/lib/schedule";
import {
  getPublicSsrSource,
  getPublicSsrSourceOutcome,
  usePublicSsrSnapshot,
} from "~/lib/ssrSeed";
import { getTerminal } from "~/lib/terminals";

function formatFreshnessTime(value: string): string {
  return DateTime.fromISO(value, { zone: "America/Los_Angeles" }).toFormat(
    "MMM d, h:mm a ZZZZ"
  );
}

const TODAY_SOURCE_LABELS = {
  route: "Clinton–Mukilteo route",
  schedule: "Today's schedule",
  nextSchedule: "Tomorrow's schedule",
  wsf: "WSF status",
  notices: "Service notices",
} as const satisfies Partial<Record<PublicSsrSourceKey, string>>;

type TodaySourceKey = keyof typeof TODAY_SOURCE_LABELS;
type RefreshableTodaySourceKey = "schedule" | "nextSchedule";
type TodaySourceOverride = PublicSsrSourceOutcome<RefreshableTodaySourceKey>;

const UNAVAILABLE_REASON_LABELS = {
  "not-published": "not published",
  "not-supported": "not supported",
  "source-unavailable": "source unavailable",
} as const;

function getTodaySourceOutcome(
  snapshot: PublicSsrSnapshot | undefined,
  key: TodaySourceKey,
  overrides: Partial<Record<RefreshableTodaySourceKey, TodaySourceOverride>>
): PublicSsrSourceOutcome<TodaySourceKey> | undefined {
  if (key === "schedule" || key === "nextSchedule") {
    const override = overrides[key];
    if (override) {
      return override;
    }
  }
  return getPublicSsrSourceOutcome(snapshot, key);
}

function getTodaySourceDescription(
  label: string,
  source: PublicSsrSourceOutcome<TodaySourceKey>
): string {
  switch (source.outcome) {
    case "authoritatively-unavailable":
      return `${label}: ${UNAVAILABLE_REASON_LABELS[source.reason]}; checked`;
    case "empty":
      return `${label}: no current public results; checked`;
    case "stale-usable":
      return `${label}: stale public data from`;
    case "value":
      return source.sourceUpdatedAt ? `${label} updated` : `${label} checked`;
  }
}

interface TodaySourceFreshnessProps {
  nextScheduleOutcome: PublicSsrSourceOutcome<"nextSchedule"> | undefined;
  pageRenderedAt: string | null;
  scheduleOutcome: PublicSsrSourceOutcome<"schedule"> | undefined;
}

function TodaySourceFreshness({
  nextScheduleOutcome,
  pageRenderedAt,
  scheduleOutcome,
}: TodaySourceFreshnessProps): ReactElement | null {
  const snapshot = usePublicSsrSnapshot();
  if (!snapshot) {
    return null;
  }
  const overrides = {
    nextSchedule: nextScheduleOutcome,
    schedule: scheduleOutcome,
  };

  return (
    <div
      aria-label="Today source freshness"
      className="text-xs opacity-80"
      data-public-ssr-freshness="schedule"
    >
      {(Object.entries(TODAY_SOURCE_LABELS) as [TodaySourceKey, string][]).map(
        ([key, label]) => {
          const source = getTodaySourceOutcome(snapshot, key, overrides);
          if (!source) {
            return null;
          }
          const sourceTime = source.sourceUpdatedAt ?? source.observedAt;
          return (
            <p
              data-public-ssr-outcome={source.outcome}
              data-public-ssr-source={key}
              key={key}
            >
              {getTodaySourceDescription(label, source)}{" "}
              <time dateTime={sourceTime}>
                {formatFreshnessTime(sourceTime)}
              </time>
            </p>
          );
        }
      )}
      {pageRenderedAt ? (
        <p>
          Page generated{" "}
          <time dateTime={pageRenderedAt}>
            {formatFreshnessTime(pageRenderedAt)}
          </time>
        </p>
      ) : null}
    </div>
  );
}

function getBoatCount(schedule: Schedule): number {
  let firstBoat: string | null = null;
  let boatCount = 0;
  for (const slot of schedule.slots) {
    if (slot.hasPassed) {
      continue;
    }
    const boat = slot.vessel.id;
    if (isNull(firstBoat)) {
      firstBoat = boat;
      boatCount++;
      continue;
    }
    if (boat === firstBoat) {
      break;
    }
    boatCount++;
  }
  return boatCount;
}

export const Today = (): ReactElement => {
  const { clock } = useAppRenderContext();
  const snapshot = usePublicSsrSnapshot();
  const seededSchedule = getPublicSsrSource(snapshot, "schedule");
  const seededNextSchedule = getPublicSsrSource(snapshot, "nextSchedule");
  const seededScheduleOutcome = getPublicSsrSourceOutcome(snapshot, "schedule");
  const seededNextScheduleOutcome = getPublicSsrSourceOutcome(
    snapshot,
    "nextSchedule"
  );
  const [pageRenderedAt, setPageRenderedAt] = useState<string | null>(
    () => snapshot?.renderedAt ?? null
  );
  const [scheduleOutcome, setScheduleOutcome] = useState<
    PublicSsrSourceOutcome<"schedule"> | undefined
  >(() => seededScheduleOutcome);
  const [nextScheduleOutcome, setNextScheduleOutcome] = useState<
    PublicSsrSourceOutcome<"nextSchedule"> | undefined
  >(() => seededNextScheduleOutcome);
  const [schedule, setSchedule] = useState<Schedule | null>(
    () => seededSchedule?.schedule ?? null
  );
  const [nextSchedule, setNextSchedule] = useState<Schedule | null>(
    () => seededNextSchedule?.schedule ?? null
  );
  const [isUpdating, setUpdating] = useState<boolean>(false);
  const [[terminal, mate], setTerminals] = useState<Array<Terminal | null>>([
    null,
  ]);

  const setRoute = async (
    terminalSlug: string,
    mateSlug?: string
  ): Promise<void> => {
    const terminal = await getTerminal(terminalSlug);
    let mate: Terminal | null = null;
    if (mateSlug) {
      mate = await getTerminal(mateSlug);
    }
    if (!mate || !findWhere(terminal.mates, { id: mate.id })) {
      mate = terminal?.mates?.[0] ?? null;
    }
    setTerminals([terminal, mate]);
  };

  useEffect(() => {
    setRoute("clinton", "mukilteo");
  }, []);

  const now = DateTime.fromMillis(clock(), {
    zone: "America/Los_Angeles",
  });

  const updateSchedule = async (): Promise<void> => {
    if (isUpdating || !terminal || !mate) {
      return;
    }
    setUpdating(true);
    try {
      const currentResponse = requireScheduleResponse(
        await getSchedule(terminal, mate, now)
      );
      setSchedule(currentResponse.schedule);
      const liveSourceUpdatedAt = DateTime.fromSeconds(
        currentResponse.timestamp,
        {
          zone: "utc",
        }
      ).toISO();
      const observedAt = DateTime.fromMillis(clock(), {
        zone: "utc",
      }).toISO();
      if (liveSourceUpdatedAt && observedAt) {
        setScheduleOutcome({
          observedAt,
          outcome: "value",
          sourceUpdatedAt: liveSourceUpdatedAt,
          value: currentResponse,
        });
        setPageRenderedAt(null);
      }
      const nextResponse = requireScheduleResponse(
        await getSchedule(terminal, mate, now.plus({ days: 1 }))
      );
      setNextSchedule(nextResponse.schedule);
      const nextSourceUpdatedAt = DateTime.fromSeconds(nextResponse.timestamp, {
        zone: "utc",
      }).toISO();
      if (nextSourceUpdatedAt && observedAt) {
        setNextScheduleOutcome({
          observedAt,
          outcome: "value",
          sourceUpdatedAt: nextSourceUpdatedAt,
          value: nextResponse,
        });
      }
    } catch (error) {
      console.error(error);
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    updateSchedule();
  }, [terminal, mate]);

  if (!schedule && !snapshot) {
    return (
      <main
        className={clsx(
          "fixed inset-0 h-full p-8",
          "bg-green-dark text-white",
          "flex flex-col items-center justify-between"
        )}
      >
        <SkeletonGroup
          className="flex h-full w-full flex-col items-center justify-between"
          label="Loading today's boat count"
        >
          <div />
          <div className="flex w-full flex-col items-center gap-2">
            <Skeleton className="h-7 w-72 max-w-full" variant="text" />
            <Skeleton className="h-4 w-40" variant="text" />
          </div>
          <Skeleton className="h-28 w-24" />
          <div className="flex w-full flex-col items-center gap-2">
            <Skeleton className="h-4 w-44" variant="text" />
            <Skeleton className="h-4 w-56 max-w-full" variant="text" />
          </div>
          <div />
        </SkeletonGroup>
      </main>
    );
  }

  if (!schedule) {
    return (
      <>
        <SeoHelmet seo={getSeoMetadata("/today")} title="How Many Boats?" />
        <main
          className={clsx(
            "fixed inset-0 h-full overflow-auto p-8",
            "bg-green-dark text-center text-white",
            "flex flex-col items-center justify-between"
          )}
        >
          <div />
          <div className="flex flex-col gap-2">
            <h1 className="font-bold text-xl">
              How Many Boats Are There Today?
            </h1>
            <span className="block text-sm italic">
              (A{" "}
              <a href="https://ferry.fyi/clinton" className="link">
                Ferry FYI
              </a>{" "}
              project)
            </span>
          </div>
          <h2 className="text-3xl font-bold">Boat count unavailable</h2>
          <div className="flex flex-col gap-2">
            <Link to="/clinton" className="link">
              See schedule, alerts, cameras.
            </Link>
            <TodaySourceFreshness
              nextScheduleOutcome={nextScheduleOutcome}
              pageRenderedAt={pageRenderedAt}
              scheduleOutcome={scheduleOutcome}
            />
          </div>
          <div />
        </main>
      </>
    );
  }

  const todayCount = getBoatCount(schedule);
  let nextCount: number | null = null;
  if (nextSchedule && now.hour >= 22) {
    nextCount = getBoatCount(nextSchedule);
  }

  return (
    <>
      <SeoHelmet seo={getSeoMetadata("/today")} title="How Many Boats?" />
      <main
        className={clsx(
          "fixed inset-0 h-full p-8",
          "text-white text-center",
          "flex flex-col items-center justify-between",
          { "bg-green-dark": todayCount === 2, "bg-red-dark": todayCount === 1 }
        )}
      >
        <div />
        <div className="flex flex-col gap-2">
          <h1 className="font-bold text-xl">How Many Boats Are There Today?</h1>
          <span className="block text-sm italic">
            (A{" "}
            <a href="https://ferry.fyi/clinton" className="link">
              Ferry FYI
            </a>{" "}
            project)
          </span>
        </div>
        <div className="flex flex-col items-center">
          <h2 className="text-9xl font-bold flex items-start relative">
            {todayCount}{" "}
            <span
              className={clsx(
                "text-xl",
                "-mr-6 mt-4",
                "absolute top-0 right-0"
              )}
            >
              *
            </span>
          </h2>
          {!isNull(nextCount) && (
            <span className={clsx("text-xl mt-4")}>
              {todayCount === 2 && nextCount === 1 && "But 1 tomorrow..."}
              {todayCount === 2 && nextCount === 2 && "And 2 tomorrow!"}
              {todayCount === 1 && nextCount === 1 && "And 1 tomorrow..."}
              {todayCount === 1 && nextCount === 2 && "But 2 tomorrow!"}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          * but that could change!{" "}
          <Link to="/clinton" className="link">
            See schedule, alerts, cameras.
          </Link>
          <TodaySourceFreshness
            nextScheduleOutcome={nextScheduleOutcome}
            pageRenderedAt={pageRenderedAt}
            scheduleOutcome={scheduleOutcome}
          />
        </div>
        <div />
      </main>
    </>
  );
};
