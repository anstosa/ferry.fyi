import { Alerts } from "./Alerts";
import { Cameras } from "./Cameras";
import { DateButton } from "~/components/DateButton";
import { DateTime } from "luxon";
import { findWhere } from "shared/lib/arrays";
import { Footer } from "~/components/Footer";
import { getSchedule } from "~/lib/schedule";
import { getSlug, getTerminal } from "~/lib/terminals";
import { Header } from "~/views/Header";
import { Helmet } from "react-helmet";
import { Map } from "./Map";
import { RouteSelector } from "~/components/RouteSelector";
import { Schedule } from "./Schedule";
import { Splash } from "~/components/Splash";
import { toShortDateString } from "~/lib/date";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "~/lib/browser";
import { Vessel } from "shared/contracts/vessels";
import React, { ReactElement, useEffect, useState } from "react";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";
import type { Schedule as ScheduleClass } from "shared/contracts/schedules";
import type { Terminal } from "shared/contracts/terminals";

export type View = "schedule" | "cameras" | "map" | "alerts";

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
  const [isUpdating, setUpdating] = useState<boolean>(false);
  const [[terminal, mate], setTerminals] = useState<Array<Terminal | null>>([
    null,
  ]);
  const [time, setTime] = useState<DateTime>(today);
  const [tickTimeout, setTickTimeout] = useState<number | null>(null);

  const inputDate = dateInput ? DateTime.fromISO(dateInput) : null;

  const [date, setDate] = useState<DateTime>(
    inputDate && inputDate > today ? inputDate : today
  );

  const vessels: Vessel[] = [];

  schedule?.slots?.forEach(({ vessel }) => {
    if (!vessels.find(({ id }) => id === vessel.id)) {
      vessels.push(vessel);
    }
  });

  useEffect(() => {
    tick();
    return () => {
      if (tickTimeout) {
        clearTimeout(tickTimeout);
      }
    };
  }, []);

  const tick = async (): Promise<void> => {
    await updateSchedule();
    // TODO fix type hack
    setTickTimeout(window.setTimeout(tick, 10 * 1000));
  };

  // update schedule on parameter change
  useEffect(() => {
    updateSchedule();
  }, [terminal, mate, date]);

  const isToday = date.toISODate() === today.toISODate();

  const formattedDate = [date.toFormat("ccc")];

  if (date.month !== today.month) {
    formattedDate.push(date.toFormat("MMM"));
  }

  formattedDate.push(date.toFormat("d"));

  if (date.year !== today.year) {
    formattedDate.push(date.toFormat("y"));
  }

  // remove date if outside of range
  useEffect(() => {
    if (
      schedule?.validRange &&
      date < DateTime.fromSeconds(schedule.validRange.from) &&
      date > DateTime.fromSeconds(schedule.validRange.to)
    ) {
      setDate(today);
    }
  }, [schedule?.validRange, date]);

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

    terminalSlug = getSlug(terminal.id);
    localStorage.terminalSlug = terminalSlug;
    if (mate) {
      mateSlug = getSlug(mate.id);
      localStorage.mateSlug = mateSlug;
    } else {
      delete localStorage.mateSlug;
    }

    const path = getPath({ terminal, mate: mate ?? undefined });
    setSchedule(null);
    if (pathname !== path) {
      navigate(path);
    }
  };

  const updateSchedule = async (): Promise<void> => {
    if (isUpdating || !terminal || !mate) {
      return;
    }
    setUpdating(true);
    const { schedule, timestamp } = await getSchedule(terminal, mate, date);
    setSchedule(schedule);
    setUpdating(false);

    const time = DateTime.fromSeconds(timestamp);
    setTime(time);
  };

  let content: ReactElement | null = null;

  if (view === "schedule") {
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
        <Schedule time={time} schedule={schedule} />
      </>
    );
  } else if (view === "cameras") {
    content = <Cameras terminal={terminal} />;
  } else if (view === "alerts") {
    content = <Alerts terminal={terminal} time={time} />;
  } else if (view === "map") {
    content = <Map vessels={vessels} terminal={terminal} mate={mate} />;
  }

  if (!terminal || !mate) {
    return <Splash />;
  }

  // sync to server.ts
  const title = `${terminal.name} to ${mate.name}${
    isToday ? "" : ` on ${formattedDate.join(" ")}`
  } - Ferry FYI`;

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="twitter:title" content={title} />
        <meta property="og:title" content={title} />
        <meta itemProp="name" content={title} />
        <link rel="canonical" href={`${process.env.BASE_URL}${getPath()}`} />
      </Helmet>
      {content}
      <Footer terminal={terminal} getPath={getPath} />
    </>
  );
};
