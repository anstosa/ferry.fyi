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

  const updateSchedule = async (): Promise<void> => {
    if (isUpdating || !terminal || !mate) {
      return;
    }
    setUpdating(true);
    const { schedule } = await getSchedule(terminal, mate, DateTime.local());
    setSchedule(schedule);
    setUpdating(false);
  };

  useEffect(() => {
    updateSchedule();
  }, [terminal, mate]);

  if (!schedule) {
    return <Splash />;
  }

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
          { "bg-green-dark": boatCount === 2, "bg-red-dark": boatCount === 1 }
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
        <h2 className="text-9xl font-bold flex items-start relative">
          {boatCount}{" "}
          <span
            className={clsx("text-xl", "-mr-6 mt-4", "absolute top-0 right-0")}
          >
            *
          </span>
        </h2>
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
