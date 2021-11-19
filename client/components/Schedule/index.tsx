import { DateButton } from "../DateButton";
import { DateTime } from "luxon";
import { findWhere, isEmpty } from "shared/lib/arrays";
import { Footer } from "~/components/Footer";
import { getSchedule } from "~/lib/schedule";
import { getSlug, getTerminal } from "~/lib/terminals";
import { Header } from "~/components/Header";
import { Helmet } from "react-helmet";
import { Route } from "shared/contracts/routes";
import { RouteSelector } from "~/components/RouteSelector";
import { SlotInfo } from "./Crossing/SlotInfo";
import { Splash } from "~/components/Splash";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "~/lib/browser";
import { values } from "shared/lib/objects";
import { Vessel } from "shared/contracts/vessels";
import clsx from "clsx";
import IslandIcon from "~/images/icons/solid/island-tropical.svg";
import React, { ReactElement, useEffect, useState } from "react";
import scrollIntoView from "scroll-into-view";
import type {
  Schedule as ScheduleClass,
  Slot,
} from "shared/contracts/schedules";
import type { Terminal } from "shared/contracts/terminals";

interface Props {
  onTerminalChange: (terminal: Terminal | null) => void;
  onMateChange: (mate: Terminal | null) => void;
}

export const Schedule = ({
  onTerminalChange,
  onMateChange,
}: Props): ReactElement => {
  const today = DateTime.local();
  const { terminalSlug, mateSlug } = useParams();
  const { date: dateInput } = useQuery();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [currentElement, setCurrentElement] = useState<HTMLDivElement | null>(
    null
  );
  const [expanded, setExpanded] = useState<Slot | null>(null);
  const [[terminal, mate], setTerminals] = useState<Array<Terminal | null>>([
    null,
  ]);
  const [schedule, setSchedule] = useState<ScheduleClass | null>(null);
  const [time, setTime] = useState<DateTime>(today);
  const [isUpdating, setUpdating] = useState<boolean>(false);
  const [isFooterOpen, setFooterOpen] = useState<boolean>(false);
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

  const isToday = date.toISODate() === today.toISODate();

  const formattedDate = [date.toFormat("ccc")];

  if (date.month !== today.month) {
    formattedDate.push(date.toFormat("MMM"));
  }

  formattedDate.push(date.toFormat("d"));

  if (date.year !== today.year) {
    formattedDate.push(date.toFormat("y"));
  }

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
    console.log("Updating schedule");
    updateSchedule();
  }, [terminal, mate, date]);

  // update parents on parameter change
  useEffect(() => {
    onTerminalChange(terminal);
  }, [terminal]);

  useEffect(() => {
    onMateChange(mate);
  }, [mate]);

  useEffect(() => {
    if (currentElement) {
      scrollIntoView(currentElement, { align: { top: 0.3 } });
    }
  }, [currentElement]);

  useEffect(() => {
    onMateChange(mate);
  }, [mate]);

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

    const query = isToday ? "?" : `?date=${date.toISODate()}`;

    let path;
    if (terminal?.mates?.length === 1) {
      path = `/${terminalSlug}${query}`;
    } else {
      path = `/${terminalSlug}/${mateSlug}${query}`;
    }
    setSchedule(null);
    setCurrentElement(null);
    if (pathname !== path) {
      navigate(path);
    }
  };

  const toggleExpand = (slot: Slot): void => {
    if (slot === expanded) {
      setExpanded(null);
    } else {
      setExpanded(slot);
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

  const renderSchedule = (): ReactElement | null => {
    if (!schedule?.slots) {
      return (
        <div
          className={clsx(
            "absolute inset-0",
            "bg-blue-lightest dark:bg-gray-darkest text-gray-500",
            "flex justify-center items-center"
          )}
        >
          Loading schedule...
        </div>
      );
    }
    const { slots } = schedule;
    if (isEmpty(slots)) {
      return (
        <div
          className={clsx(
            "absolute inset-0",
            "bg-blue-lightest dark:bg-gray-darkest text-gray-500",
            "flex justify-center items-center"
          )}
        >
          No sailings scheduled
          <IslandIcon className="text-2xl ml-4" />
        </div>
      );
    }
    const currentSlot = findWhere(schedule.slots, { hasPassed: false });
    const sailings = slots.map((slot) => {
      const { time: slotTime } = slot;
      let route: Route | undefined;
      if (terminal) {
        route = values(terminal.routes)?.find(({ terminalIds }) =>
          terminalIds.includes(terminal.id)
        );
      }
      return (
        <SlotInfo
          slot={slot}
          isExpanded={slotTime === expanded?.time}
          onClick={() => toggleExpand(slot)}
          key={slotTime}
          schedule={slots}
          route={route}
          setElement={(element: HTMLDivElement) => {
            if (slot === currentSlot) {
              setCurrentElement(element);
            }
          }}
          time={time}
        />
      );
    });
    return <ul>{sailings}</ul>;
  };

  if (!terminal || !mate) {
    return <Splash />;
  }

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
      </Helmet>
      <Header
        reload={updateSchedule}
        isReloading={isUpdating}
        share={{
          shareButtonText: "Share Schedule",
          sharedText: `Schedule for ${terminal.name} to ${mate.name}${
            isToday ? "" : ` for ${formattedDate.join(" ")}`
          }`,
        }}
      >
        <div className="flex-grow" />
        {terminal ? (
          <RouteSelector terminal={terminal} mate={mate} setRoute={setRoute} />
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
      <main
        className={clsx(
          "w-full max-h-full",
          "relative",
          "flex-grow flex-shrink",
          "flex flex-col items-center",
          "pr-safe-right pl-safe-left",
          "bg-white text-black dark:bg-black dark:text-white",
          isFooterOpen ? "overflow-hidden" : "overflow-y-scroll"
        )}
        id="main"
      >
        <div
          className={clsx(
            "w-full max-w-6xl bg-blue-lightest",
            "lg:border-l lg:border-r",
            "border-gray-medium dark:border-gray-dark"
          )}
        >
          {renderSchedule()}
        </div>
      </main>
      <Footer
        terminal={terminal}
        mate={mate}
        vessels={vessels}
        time={time}
        onChange={setFooterOpen}
      />
    </>
  );
};
