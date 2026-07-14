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
import { InstallPromptToast } from "~/components/InstallPromptToast";
import { Page } from "~/components/Page";
import { PageLoadError } from "~/components/PageLoadError";
import { RouteSelector } from "~/components/RouteSelector";
import { SeoHelmet } from "~/components/SeoHelmet";
import { Splash } from "~/components/Splash";
import { useQuery } from "~/lib/browser";
import { toShortDateString } from "~/lib/date";
import { getSchedule, requireScheduleResponse } from "~/lib/schedule";
import { getSlug, getTerminal } from "~/lib/terminals";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";
import { Header } from "~/views/Header";

import { AlertSubscription } from "./AlertSubscription";
import { Bulletins } from "./Bulletins";
import { Cameras } from "./Cameras";
import { Map } from "./Map";
import { Schedule } from "./Schedule";
import { TerminalDetails } from "./TerminalDetails";

export type View =
  | "schedule"
  | "cameras"
  | "terminal"
  | "map"
  | "alerts"
  | "subscribe";

type TodayOnlyView = Exclude<View, "schedule" | "terminal" | "subscribe">;

const TAB_ORDER: View[] = [
  "schedule",
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
      const time = DateTime.fromSeconds(timestamp);
      setTime(time);
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

  const selectedRoute =
    terminal && mate
      ? values(terminal.routes)?.find(({ terminalIds }) => {
          // selected route match
          return (
            terminalIds.includes(terminal.id) && terminalIds.includes(mate.id)
          );
        })
      : undefined;
  const contentResetKey = `${view}:${terminal?.id ?? ""}:${mate?.id ?? ""}:${date.toISODate()}`;
  const contentMotionKey = `${view}:${terminal?.id ?? ""}:${mate?.id ?? ""}`;
  const todayOnlyView: TodayOnlyView | null =
    view === "schedule" ||
    view === "terminal" ||
    view === "subscribe" ||
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
              <RouteSelector
                terminal={terminal}
                mate={mate}
                setRoute={setRoute}
              />
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
          loadError={scheduleError}
          onReload={updateSchedule}
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
        isReloading={isUpdating}
        mate={mate}
        reload={updateSchedule}
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
      <InstallPromptToast />
      <Footer terminal={terminal} getPath={getPath} />
    </>
  );
};
