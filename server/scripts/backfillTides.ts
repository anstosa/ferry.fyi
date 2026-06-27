import { db, dbInit } from "~/lib/db";
import { backfillTideObservations } from "~/lib/tides/backfill";
import { hydrateWsfSeed } from "~/lib/wsf/seed";

// run tide backfill cli
const main = async (): Promise<void> => {
  await dbInit;
  hydrateWsfSeed();
  const dryRun = process.argv.includes("--dry-run");
  const chunkDaysArg = process.argv.find((arg) =>
    arg.startsWith("--chunk-days=")
  );
  const chunkDays = chunkDaysArg
    ? Number(chunkDaysArg.replace("--chunk-days=", ""))
    : undefined;
  const report = await backfillTideObservations({ chunkDays, dryRun });
  console.log(JSON.stringify(report, null, 2));
};

main()
  .catch((error: Error) => {
    // cli failure guard
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // close db handle
    await db.close();
  });
