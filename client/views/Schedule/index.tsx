import { DateTime } from "luxon";
import { findWhere, isEmpty } from "shared/lib/arrays";
import { InlineLoader } from "~/components/InlineLoader";
import { SlotInfo } from "./SlotInfo";
import { useTerminals } from "../../lib/terminals";
import { values } from "shared/lib/objects";
import clsx from "clsx";
import IslandIcon from "~/images/icons/solid/island-tropical.svg";
import React, { ReactElement, useEffect, useState } from "react";
import scrollIntoView from "scroll-into-view";
import type {
  Schedule as ScheduleClass,
  Slot,
} from "shared/contracts/schedules";

interface Props {
  schedule: ScheduleClass | null;
  time: DateTime;
}

export const Schedule = ({ schedule, time }: Props): ReactElement => {
  const { terminals } = useTerminals();
  const [currentElement, setCurrentElement] = useState<HTMLDivElement | null>(
    null
  );
  const [expanded, setExpanded] = useState<Slot | null>(null);

  // update schedule on parameter change
  useEffect(() => {
    setCurrentElement(null);
  }, [schedule]);

  useEffect(() => {
    if (currentElement) {
      scrollIntoView(currentElement, { align: { top: 0.3 } });
    }
  }, [currentElement]);

  const toggleExpand = (slot: Slot): void => {
    if (slot === expanded) {
      setExpanded(null);
    } else {
      setExpanded(slot);
    }
  };

  const renderSchedule = (): ReactElement | null => {
    if (!schedule?.slots) {
      return <InlineLoader>Loading schedule...</InlineLoader>;
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
      const terminal = terminals.find(({ id }) => id === schedule.terminalId);
      if (!terminal) {
        return null;
      }
      const route = values(terminal.routes)?.find(({ terminalIds }) =>
        terminalIds.includes(schedule.terminalId)
      );
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

  if (!schedule) {
    return <InlineLoader>Loading schedule...</InlineLoader>;
  }

  return (
    <>
      <main
        className={clsx(
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
            "w-full max-w-6xl bg-blue-lightest",
            "lg:border-l lg:border-r",
            "border-gray-medium dark:border-gray-dark"
          )}
        >
          {renderSchedule()}
        </div>
      </main>
    </>
  );
};
