import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import logger from "heroku-logger";
import morgan from "morgan";
import { scheduleJob } from "node-schedule";

import { apiRouter } from "~/controllers/api";
import { staticRouter } from "~/controllers/static";
import { dbInit } from "~/lib/db";
import { updateLong, updateShort } from "~/lib/wsf";
import { Schedule } from "~/models/Schedule";

import { Route } from "./models/Route";

const forceHttps = (
  request: Request,
  response: Response,
  next: NextFunction
): void => {
  const protocol = request.get("x-forwarded-proto") || request.protocol;
  // https redirect guard
  if (protocol !== "https") {
    response.redirect(
      301,
      `https://${request.get("host")}${request.originalUrl}`
    );
    return;
  }
  next();
};

// start main app
const app = express();
// use SSL in production
if (process.env.NODE_ENV === "production") {
  app.use(forceHttps);
}
app.use(express.json());
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
