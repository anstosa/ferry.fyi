import clsx from "clsx";
import { AnimatePresence } from "framer-motion";
import { DateTime } from "luxon";
import React, {
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import scrollIntoView from "scroll-into-view";
import type { Route } from "shared/contracts/routes";
import type {
  Schedule as ScheduleClass,
  Slot,
} from "shared/contracts/schedules";
import type { Terminal } from "shared/contracts/terminals";
import { isEmpty } from "shared/lib/arrays";
import { getRecommendationServiceDate } from "shared/lib/sailingRecommendationRevision";

import { AdSlot } from "~/components/AdSlot";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { FreshnessPill } from "~/components/FreshnessPill";
import { PageLoadError } from "~/components/PageLoadError";
import { Prompt } from "~/components/Prompt";
import { ScheduleLoadingRows } from "~/components/ScheduleLoadingRows";
import { ScheduleOverview } from "~/components/ScheduleOverview";
import { Toast } from "~/components/Toast";
import { useQuery } from "~/lib/browser";
import { isWSFToday } from "~/lib/date";
import {
  type DetailTab,
  getSailingDeepLink,
  isDetailTab,
} from "~/lib/sailingDeepLink";
import { useTerminals } from "~/lib/terminals";
import { useUsefulContent } from "~/lib/usefulVisits";
import { useUser } from "~/lib/user";
import IslandIcon from "~/static/images/icons/solid/island-tropical.svg";

import { getCurrentSlot, shouldRenderNowDivider } from "./nowDivider";
import { NowDivider } from "./NowDividerView";
import { SlotInfo } from "./SlotInfo";
import {
  getCurrentRouteMaxVehicleCapacity,
  getRouteMaxVehicleCapacity,
} from "./smallBoat";

interface Props {
  arrivalTerminal?: Terminal;
  arrivalTerminalId?: string;
  checkedAt?: number | null;
  departureTerminal?: Terminal;
  departureTerminalId?: string;
  isRefreshing?: boolean;
  loadError?: Error | null;
  navigationPath?: string;
  onReload?: () => void;
  onRefresh?: () => Promise<void>;
  route?: Route;
  schedule: ScheduleClass | null;
  selectedDate?: string;
  time: DateTime;
}

interface CurrentElementState {
  element: HTMLDivElement | null;
  scheduleIdentity: string;
}

interface AdReadinessState {
  ready: boolean;
  scheduleIdentity: string;
}

// sailing query parser
const getLinkedSailingTime = (input?: string): number | null => {
  const sailingTime = Number(input);
  // valid timestamp guard
  if (!Number.isFinite(sailingTime) || sailingTime <= 0) {
    return null;
  }
  return sailingTime;
};

// render sailings with their current-time navigation boundary
export const Schedule = ({
  arrivalTerminal,
  arrivalTerminalId,
  checkedAt = null,
  departureTerminal,
  departureTerminalId,
  isRefreshing = false,
  loadError,
  navigationPath,
  onReload,
  onRefresh,
  route,
  schedule,
  selectedDate,
  time,
}: Props): ReactElement => {
  const { sailing: sailingInput, tab: tabInput } = useQuery();
  const { terminals } = useTerminals();
  const [{ isUserLoading }] = useUser();
  const [currentElement, setCurrentElement] = useState<CurrentElementState>({
    element: null,
    scheduleIdentity: "",
  });
  const [adReadiness, setAdReadiness] = useState<AdReadinessState>({
    ready: false,
    scheduleIdentity: "",
  });
  const [capacityWarningDismissed, setCapacityWarningDismissed] =
    useState<boolean>(false);
  const [expanded, setExpanded] = useState<Slot | null>(null);
  const scrolledSchedule = useRef<string | null>(null);
  const linkedSailingTime = getLinkedSailingTime(sailingInput);
  const linkedDetailTab = isDetailTab(tabInput) ? tabInput : undefined;
  const scheduleIdentity = schedule?.key ?? "";
  const hasOverview = Boolean(
    departureTerminal && arrivalTerminal && selectedDate
  );
  const usefulContentRef = useUsefulContent(
    "schedule",
    scheduleIdentity,
    Boolean(schedule?.slots?.length)
  );
  const linkedSlot =
    schedule?.slots?.find((slot) => {
      // linked sailing match
      return slot.time === linkedSailingTime;
    }) ?? null;
  const currentSlot = schedule?.slots
    ? getCurrentSlot(schedule.slots, time)
    : null;
  const scrollTargetSlot = linkedSlot ?? currentSlot;
  const showNowDividerForCurrentSlot = Boolean(
    currentSlot &&
    schedule?.slots &&
    shouldRenderNowDivider({
      schedule: schedule.slots,
      slot: currentSlot,
      time,
    })
  );
  const hasScheduleAd = Boolean(
    arrivalTerminalId && departureTerminalId && showNowDividerForCurrentSlot
  );
  const isScheduleAdReady =
    !hasScheduleAd ||
    (adReadiness.scheduleIdentity === scheduleIdentity && adReadiness.ready);

  // record the active schedule ad outcome
  const handleAdReadyChange = useCallback(
    (ready: boolean): void => {
      setAdReadiness((current) => {
        // unchanged readiness guard
        if (
          current.scheduleIdentity === scheduleIdentity &&
          current.ready === ready
        ) {
          return current;
        }
        return { ready, scheduleIdentity };
      });
    },
    [scheduleIdentity]
  );

  // retain the wait-first introduction unless a rider opens a sailing deep link
  useEffect(() => {
    // scroll readiness guard
    if (
      (hasOverview && !linkedSlot) ||
      !scheduleIdentity ||
      currentElement.scheduleIdentity !== scheduleIdentity ||
      !currentElement.element ||
      isUserLoading ||
      !isScheduleAdReady ||
      scrolledSchedule.current === scheduleIdentity
    ) {
      return;
    }
    scrolledSchedule.current = scheduleIdentity;
    scrollIntoView(currentElement.element, { align: { top: 0.3 } });
  }, [
    currentElement,
    hasOverview,
    isScheduleAdReady,
    isUserLoading,
    linkedSlot,
    scheduleIdentity,
  ]);

  // expand deep-linked sailing
  useEffect(() => {
    // linked sailing guard
    if (!linkedSlot) {
      return;
    }
    setExpanded(linkedSlot);
  }, [linkedSlot]);

  const toggleExpand = (slot: Slot): void => {
    // collapse active row
    if (slot === expanded) {
      setExpanded(null);
    } else {
      setExpanded(slot);
    }
  };

  // sailing tab share url
  const getSailingShareUrl = (slot: Slot, tab: DetailTab): string => {
    return getSailingDeepLink({
      currentUrl: window.location.href,
      date: schedule?.date ?? DateTime.fromSeconds(slot.time).toISODate() ?? "",
      sailingTime: slot.time,
      tab,
    });
  };

  const renderSchedule = (): ReactElement | null => {
    // failed initial load guard
    if (loadError && !schedule?.slots) {
      return (
        <PageLoadError
          error={loadError}
          message="Ferry FYI could not reach the schedule API. Reload and try again, or contact the developer if it keeps happening."
          onReload={() => {
            // fallback reload
            if (!onReload) {
              window.location.reload();
              return;
            }
            onReload();
          }}
          title="Schedule could not load"
        />
      );
    }
    // schedule loading guard
    if (!schedule?.slots) {
      return (
        <ScheduleLoadingSkeleton
          showPastSailings={
            !selectedDate ||
            selectedDate === getRecommendationServiceDate(time.toSeconds())
          }
        />
      );
    }
    const { slots } = schedule;
    // keep the introduction visible on empty service dates
    if (isEmpty(slots)) {
      return (
        <div
          className={clsx(
            hasOverview ? "py-10" : "absolute inset-0",
            "bg-white text-gray-500 dark:bg-black",
            "flex justify-center items-center"
          )}
        >
          No sailings scheduled
          <IslandIcon className="text-2xl ml-4" />
        </div>
      );
    }
    const currentRouteMaxVehicleCapacity = getCurrentRouteMaxVehicleCapacity(
      slots.map(({ vessel }) => {
        // collect scheduled capacity
        return vessel.vehicleCapacity;
      })
    );
    // group only completed sailings on the current ferry service date
    let earlierCount = 0;
    if (
      hasOverview &&
      selectedDate === getRecommendationServiceDate(time.toSeconds())
    ) {
      earlierCount = currentSlot ? slots.indexOf(currentSlot) : slots.length;
    }
    const olderCount = Math.max(0, earlierCount - 4);
    let hasCapacityInfo = false;
    // build sailing rows
    const sailings = slots.map((slot, index) => {
      const { time: slotTime, crossing } = slot;
      if (crossing) {
        hasCapacityInfo = true;
      }
      const terminal = terminals.find(({ id }) => {
        // selected terminal match
        return id === schedule.terminalId;
      });
      if (!terminal) {
        return null;
      }
      const routeMaxVehicleCapacity = getRouteMaxVehicleCapacity(
        currentRouteMaxVehicleCapacity,
        route?.normalVehicleMaxCapacity
      );
      const showNowDivider =
        slot === currentSlot && showNowDividerForCurrentSlot;
      return (
        <React.Fragment key={slotTime}>
          {/* current-time boundary */}
          {showNowDivider && <NowDivider time={time} />}
          <ErrorBoundary
            className="m-2"
            fallbackTitle="Sailing crashed"
            fallbackMessage="This sailing could not be shown, but the rest of the schedule is still available."
            resetKey={slotTime}
          >
            <SlotInfo
              compact={index < earlierCount}
              getSailingShareUrl={(tab) => {
                // sailing link
                return getSailingShareUrl(slot, tab);
              }}
              initialDetailTab={
                linkedSailingTime === slotTime ? linkedDetailTab : undefined
              }
              isExpanded={slotTime === expanded?.time}
              location={terminal.location}
              onClick={() => toggleExpand(slot)}
              terminalId={schedule.terminalId}
              schedule={slots}
              route={route}
              routeMaxVehicleCapacity={routeMaxVehicleCapacity}
              setElement={(element: HTMLDivElement) => {
                // preferred scroll anchor
                if (slot === scrollTargetSlot) {
                  setCurrentElement({ element, scheduleIdentity });
                }
              }}
              slot={slot}
              time={time}
            />
          </ErrorBoundary>
        </React.Fragment>
      );
    });
    return (
      <>
        {/* settle the existing placement before history and deep-link scrolling */}
        {hasScheduleAd ? (
          <AdSlot
            arrivalTerminalId={arrivalTerminalId}
            className="p-2"
            contextLabel="Schedule"
            departureTerminalId={departureTerminalId}
            onReadyChange={handleAdReadyChange}
            slot="schedule"
          />
        ) : null}
        {/* keep compact history directly above the current-time boundary */}
        {earlierCount > 0 ? (
          <div
            data-past-sailings
            key={scheduleIdentity}
            className="border-y border-black/10 dark:border-white/10"
          >
            {/* retain older history and automatically reveal deep-linked rows */}
            {olderCount > 0 ? (
              <details
                data-older-sailings
                open={
                  linkedSlot && slots.indexOf(linkedSlot) < olderCount
                    ? true
                    : undefined
                }
              >
                <summary className="min-h-7 cursor-pointer px-4 py-1 text-xs font-semibold sm:px-6">
                  Earlier sailings ({olderCount})
                </summary>
                <ul>{sailings.slice(0, olderCount)}</ul>
              </details>
            ) : null}
            <ul data-recent-sailings>
              {sailings.slice(olderCount, earlierCount)}
            </ul>
          </div>
        ) : null}
        <ul ref={usefulContentRef}>
          {/* retain now after history when the service date has finished */}
          {earlierCount > 0 && !currentSlot ? <NowDivider time={time} /> : null}
          {sailings.slice(earlierCount)}
        </ul>
        <AnimatePresence>
          {!hasCapacityInfo &&
            isWSFToday(DateTime.fromISO(schedule.date)) &&
            !capacityWarningDismissed && (
              <Prompt
                footerDocked
                level="warning"
                onClose={() => setCapacityWarningDismissed(true)}
              >
                WSF capacity info currently unavailable. Pay attention to
                cameras and forecasts to estimate load!
              </Prompt>
            )}
        </AnimatePresence>
      </>
    );
  };

  return (
    <>
      <main
        className={clsx(
          "overflow-y-auto",
          "w-full max-h-full",
          "relative",
          "flex-grow flex-shrink",
          "flex flex-col items-center",
          "pr-safe-right pl-safe-left",
          "bg-white text-black dark:bg-black dark:text-white"
        )}
        id="main"
      >
        <div className="w-full max-w-6xl bg-white dark:bg-black">
          {/* share the truthful wait summary with the anonymous server document */}
          {departureTerminal && arrivalTerminal && selectedDate ? (
            <ScheduleOverview
              mate={arrivalTerminal}
              navigationPath={navigationPath}
              schedule={schedule}
              scheduleLoading={!schedule && !loadError}
              selectedDate={selectedDate}
              terminal={departureTerminal}
              time={time}
            />
          ) : null}
          {/* retain the departures anchor without a duplicate service-date heading */}
          <div id="departures">{renderSchedule()}</div>
        </div>
        {loadError && schedule?.slots ? (
          <Toast footerDocked error>
            Could not refresh the schedule. Showing saved data.
          </Toast>
        ) : null}
        {onRefresh && schedule && Number.isFinite(checkedAt) ? (
          // float freshness above the last sailing without extending scroll content
          <div className="sticky bottom-0 z-10 flex h-0 w-full shrink-0 justify-center">
            <FreshnessPill
              className="absolute bottom-1 whitespace-nowrap"
              isRefreshing={isRefreshing}
              onClick={() => {
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

// match current compact history without reserving an extra viewport below the overview
const ScheduleLoadingSkeleton = ({
  showPastSailings,
}: {
  showPastSailings: boolean;
}): ReactElement => {
  return (
    <ScheduleLoadingRows
      label="Loading schedule"
      showPastSailings={showPastSailings}
    />
  );
};
