import { apiRouter } from "~/controllers/api";
import { dbInit } from "~/lib/db";
import { json } from "body-parser";
import { Route } from "./models/Route";
import { Schedule } from "~/models/Schedule";
import { scheduleJob } from "node-schedule";
import { staticRouter } from "~/controllers/static";
import { updateLong, updateShort } from "~/lib/wsf";
import cors from "cors";
import express from "express";
import logger from "heroku-logger";
import morgan from "morgan";
import sslify from "express-sslify";

// start main app
const app = express();
// use SSL in production
if (process.env.NODE_ENV === "production") {
  app.use(sslify.HTTPS({ trustProtoHeader: true }));
}
app.use(json());
app.use(cors());
// log requests
app.use(morgan("combined"));
// mount routes
app.use("/api", apiRouter);
app.use("/", staticRouter);

// start server
(async () => {
  await dbInit;
  // start server before initializing WSF since that can take a couple minutes
  const server = app.listen(process.env.PORT, () =>
    logger.info("Server started")
  );
  process.once("SIGUSR2 ", () => {
    logger.info("Gracefully shutting down server...");
    server.close(() => {
      logger.info("Done.");
      process.kill(process.pid, "SIGUSR2");
    });
  });
  logger.info("Initializing WSF");
  // populate WSF cache immediately
  await updateLong();
  await updateShort();
  // run slow updates every minute
  scheduleJob({ second: 0 }, updateLong);
  // run fast updates every 30 seconds
  scheduleJob({ second: [0, 30] }, updateShort);
  // clear cache at 4am
  scheduleJob({ hour: 4, minute: 0, second: 0 }, () => {
    Schedule.purge();
    Route.purge();
  });
  logger.info("WSF Initialized");
})();
