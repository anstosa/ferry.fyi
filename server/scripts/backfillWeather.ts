import { dbInit } from "~/lib/db";
import { backfillWeatherObservations } from "~/lib/weather/backfill";
import { initializeWsfSeed } from "~/lib/wsf";

// run backfill script
const run = async (): Promise<void> => {
  await dbInit;
  initializeWsfSeed();
  const dryRun = process.argv.includes("--dry-run");
  const report = await backfillWeatherObservations({ dryRun });
  console.log(JSON.stringify(report, null, 2));
};

run().catch((error: Error) => {
  console.error(error);
  process.exitCode = 1;
});
