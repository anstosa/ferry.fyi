import { DateTime } from "luxon";

import { db, dbInit } from "~/lib/db";
import { updateSchoolBreakEvents } from "~/lib/demandEvents/updateSchoolBreakEvents";

const SEATTLE_ZONE = "America/Los_Angeles";

// argument lookup
const getArgValue = (args: string[], name: string): string | null => {
  const index = args.indexOf(name);
  // missing argument guard
  if (index === -1) {
    return null;
  }
  return args[index + 1] ?? null;
};

// date option parsing
const getDateOption = (name: string): DateTime | undefined => {
  const value = getArgValue(process.argv.slice(2), name);
  // missing value guard
  if (!value) {
    return undefined;
  }
  const parsed = DateTime.fromISO(value, { zone: SEATTLE_ZONE });
  // invalid date guard
  if (!parsed.isValid) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed.startOf("day");
};

// script runner
const run = async (): Promise<void> => {
  await dbInit;
  const report = await updateSchoolBreakEvents({
    from: getDateOption("--from"),
    to: getDateOption("--to"),
  });
  console.log(
    `Persisted ${report.eventsWritten} school break events (${report.officialEvents} official ranges)`
  );
};

run()
  .catch((error: Error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
