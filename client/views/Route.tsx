import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { Schedule as ScheduleClass } from "shared/contracts/schedules";
import type { Terminal } from "shared/contracts/terminals";
import type { Vessel } from "shared/contracts/vessels";
import { findWhere } from "shared/lib/arrays";
import { values } from "shared/lib/objects";
import {
  getDatedSeoTitle,
  getRouteSeoMetadata,
  getTerminalSeoMetadata,
} from "shared/lib/seo";

import { DateButton } from "~/components/DateButton";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { Footer } from "~/components/Footer";
import { Page } from "~/components/Page";
import { PageLoadError } from "~/components/PageLoadError";
import { RouteSelector } from "~/components/RouteSelector";
import { SeoHelmet } from "~/components/SeoHelmet";
import { Splash } from "~/components/Splash";
import { useQuery } from "~/lib/browser";
import { toShortDateString } from "~/lib/date";
import { isFavoriteRoute, useFavoriteRoutes } from "~/lib/favoriteRoutes";
import {
  getSchedule,
  refreshSchedule,
  requireScheduleResponse,
} from "~/lib/schedule";
import { getSlug, getTerminal } from "~/lib/terminals";
import StarIcon from "~/static/images/icons/regular/star.svg";
import StarFilledIcon from "~/static/images/icons/solid/star.svg";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";
import { Header } from "~/views/Header";

import { AlertSubscription } from "./AlertSubscription";
import { Bulletins } from "./Bulletins";
import { Cameras } from "./Cameras";
import { Map } from "./Map";
import { Schedule } from "./Schedule";
import { TerminalDetails } from "./TerminalDetails";
import { Fares } from "./Fares";

export type View =
  | "schedule"
  | "cameras"
  | "terminal"
  | "fare"
  | "map"
  | "alerts"
  | "subscribe";

type TodayOnlyView = Exclude<
  View,
  "schedule" | "terminal" | "subscribe" | "fare"
>;

const TAB_ORDER: View[] = [
  "schedule",
  "fare",
  "cameras",
  "terminal",
  "map",
  "alerts",
  "subscribe",
];

type TabDirection = "to-left" | "to-right";

// tab order index
const getTabIndex = (input: View): number => TAB_ORDER.indexOf(input);

// tab slide direction
const getTabDirection = (previous: View, current: View): TabDirection => {
  // left tab guard
  if (getTabIndex(current) < getTabIndex(previous)) {
    return "to-left";
  }
  return "to-right";
};

const TODAY_ONLY_VIEW_LABELS: Record<TodayOnlyView, string> = {
  alerts: "alerts",
  cameras: "cameras",
  map: "map",
};

interface TodayOnlyContentProps {
  view: TodayOnlyView;
  goToToday: () => void;
}

// off-date tab fallback
const TodayOnlyContent = ({
  view,
  goToToday,
}: TodayOnlyContentProps): ReactElement => (
  <main className="flex-grow flex items-center justify-center bg-white px-8 text-center text-black dark:bg-black dark:text-white">
    <p className="text-lg">
      <button
        type="button"
        className="link text-green-dark dark:text-green-light"
        onClick={goToToday}
      >
        Go to today
      </button>{" "}
      to view {TODAY_ONLY_VIEW_LABELS[view]}
    </p>
  </main>
);

export type GetPath = (input?: {
  view?: View;
  terminal?: Terminal;
  mate?: Terminal;
}) => string;
interface Props {
  onTerminalChange?: (terminal: Terminal | null) => void;
  onMateChange?: (mate: Terminal | null) => void;
  view: View;
}

export const Route = ({
  onTerminalChange,
  onMateChange,
  view,
}: Props): ReactElement => {
  const today = DateTime.local();
  const { terminalSlug, mateSlug } = useParams();
  const { date: dateInput } = useQuery();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [schedule, setSchedule] = useState<ScheduleClass | null>(null);
  const [scheduleError, setScheduleError] = useState<Error | null>(null);
  const [routeError, setRouteError] = useState<Error | null>(null);
  const [isUpdating, setUpdating] = useState<boolean>(false);
  const [[terminal, mate], setTerminals] = useState<Array<Terminal | null>>([
    null,
  ]);
  // schedule race guard
  const scheduleRequestRef = useRef<number>(0);
  const [time, setTime] = useState<DateTime>(today);
  const inputDate = dateInput ? DateTime.fromISO(dateInput) : null;
  const [date, setDate] = useState<DateTime>(
    inputDate?.isValid ? inputDate : today
  );
  const previousViewRef = useRef<View>(view);
  const tabDirection = getTabDirection(previousViewRef.current, view);
  const [favoriteRouteIds, toggleFavoriteRoute] = useFavoriteRoutes();

  // remember selected tab
  useEffect(() => {
    previousViewRef.current = view;
  }, [view]);

  const vessels: Vessel[] = [];

  schedule?.slots?.forEach(({ vessel }) => {
    if (!vessels.find(({ id }) => id === vessel.id)) {
      vessels.push(vessel);
    }
  });

  // update clock
  useEffect(() => {
    const updateTime = (): void => {
      setTime(DateTime.local());
    };
    updateTime();
    const interval = window.setInterval(updateTime, 10 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  const isToday = date.toISODate() === today.toISODate();

  const formattedDate = [date.toFormat("ccc")];

  if (date.month !== today.month) {
    formattedDate.push(date.toFormat("MMM"));
  }

  formattedDate.push(date.toFormat("d"));

  if (date.year !== today.year) {
    formattedDate.push(date.toFormat("y"));
  }

  // update route on parameter change
  useEffect(() => {
    if (terminalSlug) {
      setRoute(terminalSlug, mateSlug);
    }
  }, [terminalSlug, mateSlug, date]);

  // update schedule on parameter change
  useEffect(() => {
    updateSchedule();
  }, [terminal, mate, date]);

  // update parents on parameter change
  useEffect(() => {
    onTerminalChange?.(terminal);
  }, [terminal]);

  useEffect(() => {
    onMateChange?.(mate);
  }, [mate]);

  const getPath: GetPath = (input = {}) => {
    const newTerminal = input.terminal || terminal;
    const newMate = input.mate || mate;
    const newView = input.view || view;

    if (!newTerminal) {
      return "";
    }

    const query = isToday ? "?" : `?date=${date.toISODate()}`;

    if (newView === "terminal") {
      return `/${getSlug(newTerminal.id)}/terminal${query}`;
    }

    let terminalPath: string;
    if (newTerminal?.mates?.length === 1) {
      terminalPath = `/${getSlug(newTerminal.id)}`;
    } else {
      terminalPath = `/${getSlug(newTerminal.id)}${
        newMate ? `/${getSlug(newMate.id)}` : ""
      }`;
    }

    const subviewPath = newView === "schedule" ? "" : `/${newView}`;

    return `${terminalPath}${subviewPath}${query}`;
  };

  // route parameter sync
  const setRoute = async (
    terminalSlug: string,
    mateSlug?: string
  ): Promise<void> => {
    try {
      const terminal = await getTerminal(terminalSlug);
      let mate: Terminal | null = null;
      // mate slug guard
      if (mateSlug) {
        mate = await getTerminal(mateSlug);
      }
      // valid mate guard
      if (!mate || !findWhere(terminal.mates, { id: mate.id })) {
        mate = terminal?.mates?.[0] ?? null;
      }
      // invalidate stale schedule
      scheduleRequestRef.current += 1;
      setRouteError(null);
      setTerminals([terminal, mate]);

      const path = getPath({ terminal, mate: mate ?? undefined });
      setScheduleError(null);
      setSchedule(null);
      // route sync guard
      if (pathname !== path) {
        navigate(path);
      }
    } catch (error) {
      const nextError =
        error instanceof Error ? error : new Error(String(error));
      console.error(nextError);
      setRouteError(nextError);
    }
  };

  // route sync retry
  const retryRouteLoad = (): void => {
    // route parameter guard
    if (!terminalSlug) {
      window.location.reload();
      return;
    }
    setRoute(terminalSlug, mateSlug).catch((error) => {
      // retry failure
      console.error(error);
    });
  };

  // reset selected date
  const goToToday = (): void => {
    setDate(DateTime.local());
  };

  const updateSchedule = async (): Promise<void> => {
    // terminal readiness guard
    if (!terminal || !mate) {
      return;
    }
    const requestId = scheduleRequestRef.current + 1;
    scheduleRequestRef.current = requestId;
    const isScheduleForRequest =
      schedule?.terminalId === terminal.id &&
      schedule?.mateId === mate.id &&
      schedule?.date === date.toISODate();
    // mismatched schedule guard
    if (!isScheduleForRequest) {
      setSchedule(null);
    }
    setUpdating(true);
    setScheduleError(null);
    try {
      const { schedule, timestamp } = requireScheduleResponse(
        await getSchedule(terminal, mate, date)
      );
      // stale response guard
      if (requestId !== scheduleRequestRef.current) {
        return;
      }
      setSchedule(schedule);
      // Some cached legacy responses lack a timestamp. Keep the current clock
      // rather than crashing the route when that happens.
      if (Number.isFinite(timestamp)) {
        setTime(DateTime.fromSeconds(timestamp));
      }
    } catch (error) {
      // stale error guard
      if (requestId !== scheduleRequestRef.current) {
        return;
      }
      const nextError =
        error instanceof Error ? error : new Error(String(error));
      console.error(nextError);
      setScheduleError(nextError);
    } finally {
      // latest request guard
      if (requestId === scheduleRequestRef.current) {
        setUpdating(false);
      }
    }
  };

  const refreshScheduleFromCache = async (): Promise<void> => {
    if (!terminal || !mate) {
      return;
    }
    setUpdating(true);
    setScheduleError(null);
    try {
      const { schedule: refreshedSchedule, timestamp } =
        requireScheduleResponse(await refreshSchedule(terminal, mate, date));
      setSchedule({ ...refreshedSchedule, sourceUpdatedAt: timestamp });
    } catch (error) {
      const nextError =
        error instanceof Error ? error : new Error(String(error));
      console.error(nextError);
      setScheduleError(nextError);
    } finally {
      setUpdating(false);
    }
  };

  const selectedRoute =
    terminal && mate
      ? values(terminal.routes)?.find(({ terminalIds }) => {
          // selected route match
          return (
            terminalIds.includes(terminal.id) && terminalIds.includes(mate.id)
          );
        })
      : undefined;
  const selectedRouteIsFavorite = isFavoriteRoute(
    favoriteRouteIds,
    selectedRoute?.id
  );
  const contentResetKey = `${view}:${terminal?.id ?? ""}:${mate?.id ?? ""}:${date.toISODate()}`;
  const contentMotionKey = `${view}:${terminal?.id ?? ""}:${mate?.id ?? ""}`;
  const todayOnlyView: TodayOnlyView | null =
  view === "schedule" ||
    view === "terminal" ||
    view === "subscribe" ||
    view === "fare" ||
    isToday
      ? null
      : view;
  let content: ReactElement | null = null;

  // off-date tab guard
  if (todayOnlyView) {
    content = <TodayOnlyContent view={todayOnlyView} goToToday={goToToday} />;
  } else if (view === "schedule") {
    content = (
      <>
        {terminal && mate && (
          <Header
            reload={updateSchedule}
            isReloading={isUpdating}
            share={{
              shareButtonText: "Share Schedule",
              sharedText: `Schedule for ${terminal.name} to ${mate.name}${
                isToday ? "" : ` for ${toShortDateString(date)}`
              }`,
            }}
            items={[
              ...(terminal.terminalUrl
                ? [
                    {
                      Icon: WSDOTIcon,
                      label: "WSF Schedule Page",
                      url: terminal.terminalUrl,
                      isBottom: true,
                    },
                  ]
                : []),
            ]}
          >
            <div className="flex-grow" />
            {terminal ? (
              <div className="flex min-w-0 items-center justify-center">
                {selectedRoute ? (
                  <button
                    type="button"
                    aria-label={
                      selectedRouteIsFavorite
                        ? `Remove ${selectedRoute.description} from favorites`
                        : `Add ${selectedRoute.description} to favorites`
                    }
                    aria-pressed={selectedRouteIsFavorite}
                    className={clsx(
                      "mr-2 flex h-8 w-8 shrink-0 items-center justify-center",
                      "rounded-full text-xl transition",
                      "hover:bg-lighten-high focus-visible:outline focus-visible:outline-2",
                      "focus-visible:outline-offset-2 focus-visible:outline-yellow-lightest",
                      selectedRouteIsFavorite
                        ? "text-yellow-lightest"
                        : "text-white/75 hover:text-white"
                    )}
                    onClick={() => {
                      toggleFavoriteRoute(selectedRoute.id).catch((error) => {
                        console.error(error);
                      });
                    }}
                  >
                    {selectedRouteIsFavorite ? (
                      <StarFilledIcon />
                    ) : (
                      <StarIcon />
                    )}
                  </button>
                ) : null}
                <RouteSelector
                  terminal={terminal}
                  mate={mate}
                  setRoute={setRoute}
                />
              </div>
            ) : (
              "Ferry FYI"
            )}
            <div className="flex-grow" />
            <DateButton
              defaultDate={date}
              onDateChange={setDate}
              validRange={schedule?.validRange || undefined}
            />
          </Header>
        )}
        <Schedule
          isRefreshing={isUpdating}
          loadError={scheduleError}
          onReload={updateSchedule}
          onRefresh={refreshScheduleFromCache}
          route={selectedRoute}
          time={time}
          schedule={schedule}
        />
      </>
    );
  } else if (view === "cameras") {
    content = <Cameras mate={mate} setRoute={setRoute} terminal={terminal} />;
  } else if (view === "terminal" && terminal) {
    content = (
      <TerminalDetails
        getPath={getPath}
        mate={mate}
        setRoute={setRoute}
        terminal={terminal}
      />
    );
  } else if (view === "fare" && terminal && mate) {
    content = (
      <Fares
        date={date}
        getPath={getPath}
        mate={mate}
        setDate={setDate}
        terminal={terminal}
      />
    );
  } else if (view === "alerts") {
    content = (
      <Bulletins
        getPath={getPath}
        mate={mate}
        setRoute={setRoute}
        terminal={terminal}
        time={time}
      />
    );
  } else if (view === "map") {
    content = (
      <Map
        mate={mate}
        setRoute={setRoute}
        terminal={terminal}
        vessels={vessels}
      />
    );
  } else if (view === "subscribe" && terminal && mate) {
    content = (
      <AlertSubscription mate={mate} setRoute={setRoute} terminal={terminal} />
    );
  }

  // initial route guard
  if (!terminal || !mate) {
    // failed route load guard
    if (routeError) {
      return (
        <Page title="Route unavailable">
          <PageLoadError
            error={routeError}
            message="Ferry FYI could not reach the route API. Reload and try again, or contact the developer if it keeps happening."
            onReload={retryRouteLoad}
            title="Route could not load"
          />
        </Page>
      );
    }
    return <Splash />;
  }

  const seoTerminal = {
    name: terminal.name,
    slug: getSlug(terminal.id),
  };
  const routeSeoTerminal = {
    ...seoTerminal,
    mates: terminal.mates ?? [],
  };
  const seoMate = {
    name: mate.name,
    slug: getSlug(mate.id),
  };
  const seo =
    view === "terminal"
      ? getTerminalSeoMetadata(seoTerminal)
      : getRouteSeoMetadata(routeSeoTerminal, seoMate, view, !isToday);
  const title = getDatedSeoTitle(
    seo,
    isToday ? undefined : formattedDate.join(" ")
  );

  return (
    <>
      <SeoHelmet seo={seo} title={title} />
      {content && (
        <ErrorBoundary
          resetKey={contentResetKey}
          fallbackTitle="Route view crashed"
          fallbackMessage="This route section hit an unexpected error. Switch tabs or try again."
        >
          <div
            className={`route-tab-motion route-tab-motion--${tabDirection}`}
            key={contentMotionKey}
          >
            {content}
          </div>
        </ErrorBoundary>
      )}
      <Footer terminal={terminal} getPath={getPath} />
    </>
  );
};
