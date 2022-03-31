import { DateTime } from "luxon";
import { findWhere } from "shared/lib/arrays";
import { getSchedule } from "~/lib/schedule";
import { getTerminal } from "~/lib/terminals";
import { Helmet } from "react-helmet";
import { isNull } from "shared/lib/identity";
import { Link } from "react-router-dom";
import { Splash } from "~/components/Splash";
import { Terminal } from "shared/contracts/terminals";
import clsx from "clsx";
import React, { ReactElement, useEffect, useState } from "react";
import type { Schedule } from "shared/contracts/schedules";

export const Today = (): ReactElement => {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [nextSchedule, setNextSchedule] = useState<Schedule | null>(null);
  const [isUpdating, setUpdating] = useState<boolean>(false);
  const [[terminal, mate], setTerminals] = useState<Array<Terminal | null>>([
    null,
  ]);

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
  };

  useEffect(() => {
    setRoute("clinton", "mukilteo");
  }, []);

  const now = DateTime.local();

  const updateSchedule = async (): Promise<void> => {
    if (isUpdating || !terminal || !mate) {
      return;
    }
    setUpdating(true);
    const { schedule } = await getSchedule(terminal, mate, now);
    setSchedule(schedule);
    setUpdating(false);
    const { schedule: nextSchedule } = await getSchedule(
      terminal,
      mate,
      now.plus({ days: 1 })
    );
    setNextSchedule(nextSchedule);
  };

  useEffect(() => {
    updateSchedule();
  }, [terminal, mate]);

  if (!schedule) {
    return <Splash />;
  }

  const getBoatCount = (schedule: Schedule): number => {
    let firstBoat: null | string = null;
    let boatCount = 0;
    for (const slot of schedule.slots) {
      if (slot.hasPassed) {
        continue;
      }
      const boat = slot.vessel.id;
      if (isNull(firstBoat)) {
        firstBoat = boat;
        boatCount++;
        continue;
      }
      if (boat === firstBoat) {
        break;
      }
      boatCount++;
    }
    return boatCount;
  };

  const todayCount = getBoatCount(schedule);
  let nextCount: number | null = null;
  if (nextSchedule && now.hour >= 22) {
    nextCount = getBoatCount(nextSchedule);
  }

  return (
    <>
      <Helmet>
        <title>How Many Boats?</title>
        <link rel="canonical" href="https://howmanyboats.today" />
      </Helmet>
      <div
        className={clsx(
          "fixed inset-0 h-full p-8",
          "text-white text-center",
          "flex flex-col items-center justify-between",
          { "bg-green-dark": todayCount === 2, "bg-red-dark": todayCount === 1 }
        )}
      >
        <div />
        <div className="flex flex-col gap-2">
          <h1 className="font-bold text-xl">How Many Boats Are There Today?</h1>
          <span className="block text-sm italic">
            (A{" "}
            <a href="https://ferry.fyi/clinton" className="link">
              Ferry FYI
            </a>{" "}
            project)
          </span>
        </div>
        <div className="flex flex-col items-center">
          <h2 className="text-9xl font-bold flex items-start relative">
            {todayCount}{" "}
            <span
              className={clsx(
                "text-xl",
                "-mr-6 mt-4",
                "absolute top-0 right-0"
              )}
            >
              *
            </span>
          </h2>
          {!isNull(nextCount) && (
            <span className={clsx("text-xl mt-4")}>
              {todayCount === 2 && nextCount === 1 && "But 1 tomorrow..."}
              {todayCount === 2 && nextCount === 2 && "And 2 tomorrow!"}
              {todayCount === 1 && nextCount === 1 && "And 1 tomorrow..."}
              {todayCount === 1 && nextCount === 2 && "But 2 tomorrow!"}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          * but that could change!{" "}
          <Link to="/clinton" className="link">
            See schedule, alerts, cameras.
          </Link>
        </div>
        <div />
      </div>
    </>
  );
};
