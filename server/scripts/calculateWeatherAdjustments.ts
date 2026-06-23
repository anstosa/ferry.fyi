import { dbInit } from "~/lib/db";
import { calculateAndPersistWeatherAdjustments } from "~/lib/weather/calculateCapacityAdjustments";

// run calculation script
const run = async (): Promise<void> => {
  await dbInit;
  const report = await calculateAndPersistWeatherAdjustments();
  console.log(JSON.stringify(report, null, 2));
};

run().catch((error: Error) => {
  console.error(error);
  process.exitCode = 1;
});
