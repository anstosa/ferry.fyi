import { DateTime } from "luxon";
import { findWhere, isEmpty } from "shared/lib/arrays";
import { Footer } from "~/components/Footer";
import { getSchedule } from "~/lib/schedule";
import { getSlug, getTerminal } from "~/lib/terminals";
import { Header } from "~/components/Header";
import { Route } from "shared/contracts/routes";
import { SlotInfo } from "./Crossing/SlotInfo";
import { Splash } from "~/components/Splash";
import { useHistory, useLocation, useParams } from "react-router-dom";
import { values } from "shared/lib/objects";
import clsx from "clsx";
import IslandIcon from "~/images/icons/solid/island-tropical.svg";
import React, { ReactElement, useEffect, useState } from "react";
import scrollIntoView from "scroll-into-view";
import type { Slot } from "shared/contracts/schedules";
import type { Terminal } from "shared/contracts/terminals";

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
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [time, setTime] = useState<DateTime>(DateTime.local());
  const [isUpdating, setUpdating] = useState<boolean>(false);
  const [isFooterOpen, setFooterOpen] = useState<boolean>(false);
  const [tickTimeout, setTickTimeout] = useState<number | null>(null);

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
    setSlots(null);
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
    const { schedule, timestamp } = await getSchedule(terminal, mate);
    setSlots(schedule.slots);
    setUpdating(false);

    const time = DateTime.fromSeconds(timestamp);
    setTime(time);
  };

  const renderSchedule = (): ReactElement | null => {
    if (!slots) {
      return null;
    }
    if (isEmpty(slots)) {
      return (
        <div
          className={clsx(
            "absolute inset-0",
            "bg-blue-lightest text-gray-500",
            "flex justify-center items-center"
          )}
        >
          No sailings scheduled
          <IslandIcon className="text-2xl ml-4" />
        </div>
      );
    }
    const currentSlot = findWhere(slots, { hasPassed: false });
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
      <Footer terminal={terminal} time={time} onChange={setFooterOpen} />
    </>
  );
};
