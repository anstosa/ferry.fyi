import { DateTime } from "luxon";
import { findWhere, isArray, isEmpty } from "~/lib/arrays";
import { Footer } from "~/components/Footer";
import { getSchedule } from "~/lib/schedule";
import { getSlug, getTerminal } from "~/lib/terminals";
import { Header } from "~/components/Header";
import { isDark } from "~/lib/theme";
import { SlotInfo } from "./Crossing/SlotInfo";
import { Splash } from "~/components/Splash";
import { useHistory, useLocation, useParams } from "react-router-dom";
import clsx from "clsx";
import React, { ReactElement, useEffect, useState } from "react";
import scrollIntoView from "scroll-into-view";
import type { Slot } from "shared/models/schedules";
import type { Terminal } from "shared/models/terminals";

interface Params {
  terminalSlug: string;
  mateSlug?: string;
}

export const Schedule = (): ReactElement => {
  const { terminalSlug, mateSlug } = useParams<Params>();
  const { pathname } = useLocation();
  const history = useHistory();
  const [hasScrolled, setScrolled] = useState<boolean>(false);
  const [currentElement, setCurrentElement] = useState<HTMLDivElement | null>(
    null
  );
  const [expanded, setExpanded] = useState<Slot | null>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [mate, setMate] = useState<Terminal | null>(null);
  const [schedule, setSchedule] = useState<Slot[] | null>(null);
  const [time, setTime] = useState<DateTime>(DateTime.local());
  const [isUpdating, setUpdating] = useState<boolean>(false);
  const [isFooterOpen, setFooterOpen] = useState<boolean>(false);
  const [tickTimeout, setTickTimeout] = useState<NodeJS.Timeout | null>();

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
    setTickTimeout(setTimeout(tick, 10 * 1000) as unknown as NodeJS.Timeout);
  };

  useEffect(() => {
    setRoute(terminalSlug, mateSlug);
  }, [terminalSlug, mateSlug]);

  useEffect(() => {
    updateSchedule();
  }, [terminal, mate]);

  useEffect(() => {
    if (!hasScrolled && currentElement) {
      scrollIntoView(currentElement, { align: { top: 0.3 } });
      setScrolled(true);
    }
  }, [hasScrolled, currentElement]);

  const setRoute = async (
    terminalSlug: string,
    mateSlug?: string
  ): Promise<void> => {
    const terminal = await getTerminal(terminalSlug);
    setTerminal(terminal);
    let mate: Terminal | null = null;
    if (mateSlug) {
      mate = await getTerminal(mateSlug);
    }
    if (!mate || !findWhere(terminal.mates, { id: mate.id })) {
      mate = terminal?.mates?.[0] ?? null;
    }
    setMate(mate);

    terminalSlug = getSlug(terminal.id);
    localStorage.terminalSlug = terminalSlug;
    if (mate) {
      mateSlug = getSlug(mate.id);
      localStorage.mateSlug = mateSlug;
    } else {
      delete localStorage.mateSlug;
    }

    let path;
    if (terminal?.mates?.length === 1) {
      path = `/${terminalSlug}`;
    } else {
      path = `/${terminalSlug}/${mateSlug}`;
    }

    if (pathname !== path) {
      history.push(path);
    }
    setSchedule(null);
    setScrolled(false);
    setCurrentElement(null);
    await updateSchedule();
  };

  const toggleExpand = (slot: Slot): void => {
    if (slot === expanded) {
      setExpanded(null);
    } else {
      setExpanded(slot);
    }
  };

  const updateSchedule = async (): Promise<void> => {
    if (!terminal || !mate) {
      return;
    }
    setUpdating(true);
    const { schedule, timestamp } = (await getSchedule(
      terminal,
      mate
    )) as unknown as {
      schedule: Slot[];
      timestamp: number;
    };
    setSchedule(schedule);
    setUpdating(false);

    const time = DateTime.fromSeconds(timestamp);
    setTime(time);
  };

  const renderSchedule = (): ReactElement | null => {
    const currentSlot = findWhere(schedule, { hasPassed: false });
    if (!schedule) {
      return null;
    }
    const sailings = schedule.map((slot) => {
      const { time: slotTime } = slot;
      return (
        <SlotInfo
          slot={slot}
          isExpanded={slotTime === expanded?.time}
          onClick={() => toggleExpand(slot)}
          key={slotTime}
          schedule={schedule}
          route={mate?.route}
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

  if (!terminal || !mate || isEmpty(schedule)) {
    let message: string | undefined;
    if (isArray(schedule)) {
      message = "Ferry FYI just updated! Fetching data from WSF...";
    }
    return <Splash>{message}</Splash>;
  }

  return (
    <>
      <Header
        terminal={terminal}
        mate={mate}
        setRoute={setRoute}
        reload={updateSchedule}
        isReloading={isUpdating}
      />
      <main
        className={clsx(
          "w-full max-h-full",
          "flex-grow flex-shrink",
          "flex flex-col items-center",
          "pr-safe-right pl-safe-left",
          isDark ? "bg-black text-white" : "bg-white text-black",
          isFooterOpen ? "overflow-hidden" : "overflow-y-scroll"
        )}
        id="main"
      >
        <div
          className={clsx(
            "w-full max-w-6xl bg-blue-lightest",
            "lg:border-l lg:border-r",
            isDark ? "border-gray-dark" : "border-gray-medium"
          )}
        >
          {renderSchedule()}
        </div>
      </main>
      <Footer terminal={terminal} time={time} onChange={setFooterOpen} />
    </>
  );
};
