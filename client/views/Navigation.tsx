import React, { type ReactElement } from "react";
import type { Schedule } from "shared/contracts/schedules";
import type { Terminal } from "shared/contracts/terminals";

import { AdSlot } from "~/components/AdSlot";
import { FreshnessPill } from "~/components/FreshnessPill";
import { RoutePageIntro } from "~/components/RoutePageIntro";
import { RoutePlanningLinks } from "~/components/RoutePlanningLinks";
import { RouteSelector } from "~/components/RouteSelector";
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
  const hasNavigationForm = isCurrentServiceDay;
  const planningLinks = (
    <RoutePlanningLinks
      currentView="navigation"
      mate={mate}
      terminal={terminal}
    />
  );
  // select by ferry terminal only, never the rider's trip origin
  const navigationAd = (
    <AdSlot
      className="mt-4"
      contextLabel={`Navigation · ${terminal.name}`}
      departureTerminalId={terminal.id}
      slot="navigation"
    />
  );
  // preserve leave-now semantics when a dated route opens this tab
  const renderContent = (): ReactElement => {
    // use the ferry service day rather than the calendar day
    if (!isCurrentServiceDay) {
      return (
        <section>
          <RoutePageIntro
            title="What boat will I make?"
            description="Leave-now estimates use the current ferry day."
          />
          {planningLinks}
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
    return (
      <SailingRecommendationCard
        afterForm={navigationAd}
        afterIntroduction={planningLinks}
        isScheduleRefreshing={isRefreshing}
        onReloadSchedule={onReload}
        onRefreshSchedule={onRefresh}
        scheduleLoadError={loadError}
        schedule={schedule}
      />
    );
  };

  return (
    <>
      <Header isReloading={isRefreshing}>
        <div className="flex min-w-0 flex-grow items-center justify-center">
          <RouteSelector terminal={terminal} mate={mate} setRoute={setRoute} />
        </div>
      </Header>
      <main
        id="main"
        className="relative flex min-h-0 flex-grow flex-col items-center overflow-y-auto bg-day-normal-light text-black pl-safe-left pr-safe-right motion-safe:scroll-smooth dark:bg-night-normal-dark dark:text-white"
      >
        <div className="w-full max-w-6xl flex-grow p-4">
          {renderContent()}
          {/* retain one placement alongside loading and recovery states */}
          {!hasNavigationForm && navigationAd}
        </div>
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
