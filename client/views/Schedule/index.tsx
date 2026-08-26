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
import { isEmpty } from "shared/lib/arrays";

import { AdSlot } from "~/components/AdSlot";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { FreshnessPill } from "~/components/FreshnessPill";
import { PageLoadError } from "~/components/PageLoadError";
import { Prompt } from "~/components/Prompt";
import { ScheduleLoadingRows } from "~/components/ScheduleLoadingRows";
import { Toast } from "~/components/Toast";
import { useQuery } from "~/lib/browser";
import { isWSFToday } from "~/lib/date";
import {
  type DetailTab,
  getSailingDeepLink,
  isDetailTab,
} from "~/lib/sailingDeepLink";
import { useTerminals } from "~/lib/terminals";
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
  arrivalTerminalId?: string;
  checkedAt?: number | null;
  departureTerminalId?: string;
  isRefreshing?: boolean;
  loadError?: Error | null;
  onReload?: () => void;
  onRefresh?: () => Promise<void>;
  route?: Route;
  schedule: ScheduleClass | null;
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

export const Schedule = ({
  arrivalTerminalId,
  checkedAt = null,
  departureTerminalId,
  isRefreshing = false,
  loadError,
  onReload,
  onRefresh,
  route,
  schedule,
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
  const currentSlot = schedule?.slots
    ? getCurrentSlot(schedule.slots, time)
    : null;
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

  // scroll once after schedule, entitlement, and ad settlement
  useEffect(() => {
    // scroll readiness guard
    if (
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
  }, [currentElement, isScheduleAdReady, isUserLoading, scheduleIdentity]);

  // expand deep-linked sailing
  useEffect(() => {
    // schedule readiness guard
    if (!schedule?.slots || !linkedSailingTime) {
      return;
    }
    const linkedSlot = schedule.slots.find((slot) => {
      // linked sailing match
      return slot.time === linkedSailingTime;
    });
    // linked slot guard
    if (linkedSlot) {
      setExpanded(linkedSlot);
    }
  }, [linkedSailingTime, schedule]);

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
      return <ScheduleLoadingSkeleton />;
    }
    const { slots } = schedule;
    if (isEmpty(slots)) {
      return (
        <div
          className={clsx(
            "absolute inset-0",
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
    let hasCapacityInfo = false;
    // build sailing rows
    const sailings = slots.map((slot) => {
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
          {showNowDivider && (
            <>
              {arrivalTerminalId && departureTerminalId ? (
                <li>
                  <AdSlot
                    arrivalTerminalId={arrivalTerminalId}
                    className="p-2"
                    contextLabel="Schedule"
                    departureTerminalId={departureTerminalId}
                    onReadyChange={handleAdReadyChange}
                    slot="schedule"
                  />
                </li>
              ) : null}
              <NowDivider />
            </>
          )}
          <ErrorBoundary
            className="m-2"
            fallbackTitle="Sailing crashed"
            fallbackMessage="This sailing could not be shown, but the rest of the schedule is still available."
            resetKey={slotTime}
          >
            <SlotInfo
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
                // current slot anchor
                if (slot === currentSlot) {
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
        <ul>{sailings}</ul>
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
        <div
          className={clsx(
            "w-full max-w-6xl bg-white dark:bg-black",
            "lg:border-l lg:border-r",
            "border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.08)]"
          )}
        >
          {renderSchedule()}
        </div>
        {loadError && schedule?.slots ? (
          <Toast footerDocked error>
            Could not refresh the schedule. Showing saved data.
          </Toast>
        ) : null}
        {onRefresh && schedule && Number.isFinite(checkedAt) ? (
          <div className="sticky bottom-1 z-10 mt-2 flex justify-center pb-1">
            <FreshnessPill
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

const ScheduleLoadingSkeleton = (): ReactElement => {
  return (
    <ScheduleLoadingRows
      className="h-[calc(100vh-8rem-var(--safe-area-inset-top)-var(--safe-area-inset-bottom))]"
      label="Loading schedule"
    />
  );
};
