import React, { type ReactElement } from "react";
import type { Schedule } from "shared/contracts/schedules";
import type { Terminal } from "shared/contracts/terminals";

import { FreshnessPill } from "~/components/FreshnessPill";
import { PageLoadError } from "~/components/PageLoadError";
import { RouteSelector } from "~/components/RouteSelector";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";
import { Toast } from "~/components/Toast";

import { Header } from "./Header";
import { SailingRecommendationCard } from "./Schedule/SailingRecommendationCard";

interface Props {
  checkedAt: number | null;
  isCurrentServiceDay: boolean;
  isRefreshing: boolean;
  loadError: Error | null;
  mate: Terminal;
  onGoToCurrentDay: () => void;
  onRefresh: () => Promise<Schedule | null>;
  onReload: () => Promise<void>;
  schedule: Schedule | null;
  setRoute: (terminal: string, mate?: string) => void;
  terminal: Terminal;
}

// keep origin entry and transient results in their own route tab
export const Navigation = ({
  checkedAt,
  isCurrentServiceDay,
  isRefreshing,
  loadError,
  mate,
  onGoToCurrentDay,
  onRefresh,
  onReload,
  schedule,
  setRoute,
  terminal,
}: Props): ReactElement => {
  // preserve leave-now semantics when a dated route opens this tab
  const renderContent = (): ReactElement => {
    // use the ferry service day rather than the calendar day
    if (!isCurrentServiceDay) {
      return (
        <section className="m-3 rounded-xl border border-gray-200 bg-white p-5 text-center dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-lg font-semibold">What boat will I make?</h2>
          <p className="mt-2 text-sm">
            Leave-now estimates use the current ferry day.
          </p>
          <button
            type="button"
            className="button button-primary mt-4"
            onClick={onGoToCurrentDay}
          >
            Use current ferry day
          </button>
        </section>
      );
    }
    // retain the existing API recovery path before asking for an origin
    if (loadError && !schedule) {
      return (
        <PageLoadError
          error={loadError}
          title="Navigation could not load"
          message="Ferry FYI could not load the schedule needed for your trip. Reload and try again."
          onReload={() => {
            // retry schedule loading without requesting travel directions
            onReload().catch(console.error);
          }}
        />
      );
    }
    // wait for the route schedule without acquiring a location
    if (!schedule) {
      return (
        <SkeletonGroup className="m-3 space-y-4 p-4" label="Loading navigation">
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </SkeletonGroup>
      );
    }
    return (
      <SailingRecommendationCard
        key={schedule.key}
        onRefreshSchedule={onRefresh}
        schedule={schedule}
      />
    );
  };

  return (
    <>
      <Header isReloading={isRefreshing}>
        <h1 className="sr-only">Navigation</h1>
        <div className="flex min-w-0 flex-grow items-center justify-center">
          <RouteSelector terminal={terminal} mate={mate} setRoute={setRoute} />
        </div>
      </Header>
      <main
        id="main"
        className="relative flex min-h-0 flex-grow flex-col items-center overflow-y-auto bg-day-normal-light text-black pl-safe-left pr-safe-right dark:bg-night-normal-dark dark:text-white"
      >
        <div className="w-full max-w-2xl flex-grow py-2">{renderContent()}</div>
        {/* preserve cached data when an explicit schedule refresh fails */}
        {loadError && schedule && isCurrentServiceDay ? (
          <Toast footerDocked error>
            Could not refresh the schedule. Showing saved data.
          </Toast>
        ) : null}
        {/* refresh the schedule without repeating a travel-provider request */}
        {schedule && isCurrentServiceDay && Number.isFinite(checkedAt) ? (
          <div className="sticky bottom-1 z-10 mt-2 flex justify-center pb-1">
            <FreshnessPill
              isRefreshing={isRefreshing}
              onClick={() => {
                // request only the existing cached schedule refresh
                onRefresh().catch(console.error);
              }}
              sourceUpdatedAt={checkedAt}
            />
          </div>
        ) : null}
      </main>
    </>
  );
};
