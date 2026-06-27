import { db, dbInit } from "~/lib/db";
import { updateTideForecasts } from "~/lib/tides/updateForecasts";
import { hydrateWsfSeed } from "~/lib/wsf/seed";

// run tide forecast cli
const main = async (): Promise<void> => {
  await dbInit;
  hydrateWsfSeed();
  const force = process.argv.includes("--force");
  const report = await updateTideForecasts({ force });
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
