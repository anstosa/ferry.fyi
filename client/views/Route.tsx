import clsx from "clsx";
import { DateTime } from "luxon";
import React, {
  ReactElement,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { RouteLoadingState } from "~/components/RouteLoadingState";
import { RouteSelector } from "~/components/RouteSelector";
import { SeoHelmet } from "~/components/SeoHelmet";
import { useQuery } from "~/lib/browser";
import { toShortDateString } from "~/lib/date";
import { isFavoriteRoute, useFavoriteRoutes } from "~/lib/favoriteRoutes";
import { useAppRenderContext } from "~/lib/renderContext";
import type { RouteView } from "~/lib/routeViews";
import {
  getSchedule,
  refreshSchedule,
  requireScheduleResponse,
} from "~/lib/schedule";
import { getPublicSsrSource, usePublicSsrSnapshot } from "~/lib/ssrSeed";
import { getSlug, getTerminal } from "~/lib/terminals";
import { getVesselAssignmentSet } from "~/lib/vesselAssignments";
import StarIcon from "~/static/images/icons/regular/star.svg";
import StarFilledIcon from "~/static/images/icons/solid/star.svg";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";
import { Header } from "~/views/Header";

const loadAlertSubscription = () =>
  import("./AlertSubscription").then(({ AlertSubscription }) => ({
    default: AlertSubscription,
  }));
const AlertSubscription = React.lazy(loadAlertSubscription);
const loadBulletins = () =>
  import("./Bulletins").then(({ Bulletins }) => ({ default: Bulletins }));
const Bulletins = React.lazy(loadBulletins);
const loadCameras = () =>
  import("./Cameras").then(({ Cameras }) => ({ default: Cameras }));
const Cameras = React.lazy(loadCameras);
const loadFares = () =>
  import("./Fares").then(({ Fares }) => ({ default: Fares }));
const Fares = React.lazy(loadFares);
const loadMap = () =>
  import("./Map").then(({ Map }) => ({
    default: Map,
  }));
const Map = React.lazy(loadMap);
const loadSchedule = () =>
  import("./Schedule").then(({ Schedule }) => ({ default: Schedule }));
const Schedule = React.lazy(loadSchedule);
const loadTerminalDetails = () =>
  import("./TerminalDetails").then(({ TerminalDetails }) => ({
    default: TerminalDetails,
  }));
const TerminalDetails = React.lazy(loadTerminalDetails);

export type { RouteView as View } from "~/lib/routeViews";

type View = RouteView;

const normalizePath = (path: string): string => path.replace(/\/+$/, "") || "/";

const routeViewForPath = (pathname: string): View => {
  const parts = pathname.split("/").filter(Boolean);
  const view = parts[parts.length - 1];
  return view === "cameras" ||
    view === "terminal" ||
    view === "fare" ||
    view === "map" ||
    view === "alerts" ||
    view === "subscribe"
    ? view
    : "schedule";
};

/** Load the route shell and the selected tab before replacing a seeded page. */
export const preloadRouteView = async (pathname: string): Promise<void> => {
  switch (routeViewForPath(pathname)) {
    case "cameras":
      await loadCameras();
      return;
    case "terminal":
      await loadTerminalDetails();
      return;
    case "fare":
      await loadFares();
      return;
    case "map":
      await loadMap();
      return;
    case "alerts":
      await loadBulletins();
      return;
    case "subscribe":
      await loadAlertSubscription();
      return;
    case "schedule":
      await loadSchedule();
  }
};

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

export const getRouteTabClassName = (
  view: View,
  direction: TabDirection
): string =>
  clsx(
    "route-tab-motion",
    `route-tab-motion--${direction}`,
    view === "fare" && "bg-day-normal-light dark:bg-night-normal-dark"
  );

const getNormalizedRouteQuery = (search: string, view: View): string => {
  const query = new URLSearchParams();
  [...new URLSearchParams(search)]
    .filter(
      ([key]) => key === "date" || (view === "fare" && key.startsWith("fare"))
    )
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey)
    )
    .forEach(([key, value]) => query.append(key, value));
  return query.toString();
};

const getNavigationIdentity = ({
  mateSlug,
  pathname,
  search,
  terminalSlug,
  view,
}: {
  mateSlug?: string;
  pathname: string;
  search: string;
  terminalSlug?: string;
  view: View;
}): string =>
  JSON.stringify([
    normalizePath(pathname),
    terminalSlug ?? "",
    mateSlug ?? "",
    view,
    getNormalizedRouteQuery(search, view),
  ]);

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
  const { clock } = useAppRenderContext();
  const todayKey = DateTime.fromMillis(clock()).toISODate() ?? "";
  const today = useMemo(() => DateTime.fromISO(todayKey), [todayKey]);
  const { terminalSlug, mateSlug } = useParams();
  const { date: dateInput } = useQuery();
  const { pathname, search } = useLocation();
  const navigationIdentity = getNavigationIdentity({
    mateSlug,
    pathname,
    search,
    terminalSlug,
    view,
  });
  const activeNavigationIdentityRef = useRef(navigationIdentity);
  activeNavigationIdentityRef.current = navigationIdentity;
  const snapshot = usePublicSsrSnapshot();
  const snapshotSearch = snapshot
    ? new URLSearchParams(snapshot.normalizedUrl.query).toString()
    : "";
  const hasMatchingSnapshotRoute =
    snapshot !== undefined &&
    normalizePath(snapshot.canonicalPath) === normalizePath(pathname) &&
    snapshot.routeParams.terminalSlug === terminalSlug &&
    snapshot.routeParams.mateSlug === mateSlug &&
    getNormalizedRouteQuery(snapshotSearch, view) ===
      getNormalizedRouteQuery(search, view);
  const seededRoute = hasMatchingSnapshotRoute
    ? getPublicSsrSource(snapshot, "route")
    : undefined;
  const seededSchedule = hasMatchingSnapshotRoute
    ? getPublicSsrSource(snapshot, "schedule")
    : undefined;
  const seededVessels = hasMatchingSnapshotRoute
    ? getPublicSsrSource(snapshot, "vessels")
    : undefined;
  const navigate = useNavigate();
  const urlDateKey = useMemo(() => {
    const inputDate = dateInput ? DateTime.fromISO(dateInput) : null;
    return inputDate?.isValid ? (inputDate.toISODate() ?? todayKey) : todayKey;
  }, [dateInput, todayKey]);
  const urlDate = useMemo(() => DateTime.fromISO(urlDateKey), [urlDateKey]);
  const [dateState, setDateState] = useState<{
    date: DateTime;
    identity: string;
  }>(() => ({
    date: urlDate,
    identity: navigationIdentity,
  }));
  const date =
    dateState.identity === navigationIdentity ? dateState.date : urlDate;
  const scheduleIdentity = `${navigationIdentity}:${date.toISODate() ?? ""}`;
  const activeScheduleIdentityRef = useRef(scheduleIdentity);
  activeScheduleIdentityRef.current = scheduleIdentity;
  const [scheduleState, setScheduleState] = useState<{
    identity: string;
    isLive: boolean;
    schedule: ScheduleClass | null;
  }>(() => ({
    identity: scheduleIdentity,
    isLive: false,
    schedule: seededSchedule?.schedule ?? null,
  }));
  const schedule =
    scheduleState.identity === scheduleIdentity ? scheduleState.schedule : null;
  const scheduleIsLive =
    scheduleState.identity === scheduleIdentity && scheduleState.isLive;
  const [scheduleErrorState, setScheduleErrorState] = useState<{
    error: Error | null;
    identity: string;
  }>({ error: null, identity: scheduleIdentity });
  const scheduleError =
    scheduleErrorState.identity === scheduleIdentity
      ? scheduleErrorState.error
      : null;
  const [routeErrorState, setRouteErrorState] = useState<{
    error: Error | null;
    identity: string;
  }>({ error: null, identity: navigationIdentity });
  const routeError =
    routeErrorState.identity === navigationIdentity
      ? routeErrorState.error
      : null;
  const [updatingIdentity, setUpdatingIdentity] = useState<string | null>(null);
  const isUpdating = updatingIdentity === scheduleIdentity;
  const [terminalState, setTerminalState] = useState<{
    identity: string;
    terminals: Array<Terminal | null>;
  }>(() => ({
    identity: navigationIdentity,
    terminals: seededRoute
      ? ([seededRoute.terminal, seededRoute.mate] as Terminal[])
      : [null],
  }));
  const resolvedTerminals =
    terminalState.identity === navigationIdentity
      ? terminalState.terminals
      : [null];
  const [resolvedTerminal, resolvedMate] = resolvedTerminals;
  const resolvedRouteMatchesPath =
    resolvedTerminal !== null &&
    getSlug(resolvedTerminal.id) === terminalSlug &&
    (!mateSlug ||
      (resolvedMate !== null && getSlug(resolvedMate.id) === mateSlug));
  const terminal = resolvedRouteMatchesPath ? resolvedTerminal : null;
  const mate = resolvedRouteMatchesPath ? resolvedMate : null;
  const [time, setTime] = useState<DateTime>(today);
  const previousViewRef = useRef<View>(view);
  const tabDirection = getTabDirection(previousViewRef.current, view);
  const [favoriteRouteIds, toggleFavoriteRoute] = useFavoriteRoutes();

  // remember selected tab
  useEffect(() => {
    previousViewRef.current = view;
  }, [view]);

  const scheduleMatchesRoute =
    schedule?.terminalId === terminal?.id &&
    schedule?.mateId === mate?.id &&
    schedule?.date === date.toISODate();
  const displayedSchedule = scheduleMatchesRoute ? schedule : null;
  const vesselAssignments = useMemo(() => {
    if (scheduleIsLive && displayedSchedule) {
      return getVesselAssignmentSet(
        displayedSchedule.slots.map(({ vessel }) => vessel)
      );
    }
    return {
      identity: "",
      vessels: [...(seededVessels ?? [])] as Vessel[],
    };
  }, [displayedSchedule, scheduleIsLive, seededVessels]);

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
    const routeMatchesPath =
      terminal &&
      mate &&
      getSlug(terminal.id) === terminalSlug &&
      (!mateSlug || getSlug(mate.id) === mateSlug);
    if (terminalSlug && !routeMatchesPath) {
      setRoute(terminalSlug, mateSlug);
    }
  }, [mate, mateSlug, seededRoute, terminal, terminalSlug]);

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

    const queryParams = new URLSearchParams();
    if (!isToday) {
      queryParams.set("date", date.toISODate() ?? "");
    }
    if (newView === "fare") {
      for (const [key, value] of new URLSearchParams(search)) {
        if (key.startsWith("fare")) {
          queryParams.set(key, value);
        }
      }
    }
    const query = queryParams.size ? `?${queryParams.toString()}` : "";

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
    const requestIdentity = activeNavigationIdentityRef.current;
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
      if (activeNavigationIdentityRef.current !== requestIdentity) {
        return;
      }

      const path = getPath({ terminal, mate: mate ?? undefined });
      // route sync guard
      if (`${pathname}${search}` !== path) {
        navigate(path);
        return;
      }
      setRouteErrorState({ error: null, identity: requestIdentity });
      setTerminalState({
        identity: requestIdentity,
        terminals: [terminal, mate],
      });
    } catch (error) {
      if (activeNavigationIdentityRef.current !== requestIdentity) {
        return;
      }
      const nextError =
        error instanceof Error ? error : new Error(String(error));
      console.error(nextError);
      setRouteErrorState({ error: nextError, identity: requestIdentity });
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
    setDateState({ date: DateTime.local(), identity: navigationIdentity });
  };

  const updateSchedule = async (): Promise<void> => {
    // terminal readiness guard
    if (!terminal || !mate) {
      return;
    }
    const requestIdentity = scheduleIdentity;
    const isScheduleForRequest =
      schedule?.terminalId === terminal.id &&
      schedule?.mateId === mate.id &&
      schedule?.date === date.toISODate();
    // mismatched schedule guard
    if (!isScheduleForRequest) {
      setScheduleState({
        identity: requestIdentity,
        isLive: false,
        schedule: null,
      });
    }
    setUpdatingIdentity(requestIdentity);
    setScheduleErrorState({ error: null, identity: requestIdentity });
    try {
      const { schedule, timestamp } = requireScheduleResponse(
        await getSchedule(terminal, mate, date)
      );
      // stale response guard
      if (requestIdentity !== activeScheduleIdentityRef.current) {
        return;
      }
      setScheduleState({
        identity: requestIdentity,
        isLive: true,
        schedule,
      });
      // Some cached legacy responses lack a timestamp. Keep the current clock
      // rather than crashing the route when that happens.
      if (Number.isFinite(timestamp)) {
        setTime(DateTime.fromSeconds(timestamp));
      }
    } catch (error) {
      // stale error guard
      if (requestIdentity !== activeScheduleIdentityRef.current) {
        return;
      }
      const nextError =
        error instanceof Error ? error : new Error(String(error));
      console.error(nextError);
      setScheduleErrorState({ error: nextError, identity: requestIdentity });
    } finally {
      // latest request guard
      if (requestIdentity === activeScheduleIdentityRef.current) {
        setUpdatingIdentity(null);
      }
    }
  };

  const refreshScheduleFromCache = async (): Promise<void> => {
    if (!terminal || !mate) {
      return;
    }
    const requestIdentity = scheduleIdentity;
    setUpdatingIdentity(requestIdentity);
    setScheduleErrorState({ error: null, identity: requestIdentity });
    try {
      const { schedule: refreshedSchedule, timestamp } =
        requireScheduleResponse(await refreshSchedule(terminal, mate, date));
      if (requestIdentity !== activeScheduleIdentityRef.current) {
        return;
      }
      setScheduleState({
        identity: requestIdentity,
        isLive: true,
        schedule: { ...refreshedSchedule, sourceUpdatedAt: timestamp },
      });
    } catch (error) {
      if (requestIdentity !== activeScheduleIdentityRef.current) {
        return;
      }
      const nextError =
        error instanceof Error ? error : new Error(String(error));
      console.error(nextError);
      setScheduleErrorState({ error: nextError, identity: requestIdentity });
    } finally {
      if (requestIdentity === activeScheduleIdentityRef.current) {
        setUpdatingIdentity(null);
      }
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
              onDateChange={(nextDate) =>
                setDateState({ date: nextDate, identity: navigationIdentity })
              }
              validRange={displayedSchedule?.validRange || undefined}
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
          schedule={displayedSchedule}
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
        mate={mate}
        setDate={(nextDate) =>
          setDateState({ date: nextDate, identity: navigationIdentity })
        }
        setRoute={setRoute}
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
        requestIdentity={scheduleIdentity}
        setRoute={setRoute}
        terminal={terminal}
        vesselIdentity={vesselAssignments.identity}
        vessels={vesselAssignments.vessels}
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
    return <RouteLoadingState view={view} />;
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
          <Suspense fallback={<RouteLoadingState hasRouteFooter view={view} />}>
            <div
              className={getRouteTabClassName(view, tabDirection)}
              key={contentMotionKey}
            >
              {content}
            </div>
          </Suspense>
        </ErrorBoundary>
      )}
      <Footer terminal={terminal} getPath={getPath} />
    </>
  );
};
