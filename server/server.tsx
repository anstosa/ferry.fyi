import { App } from "../client/App";
import { DateTime } from "luxon";
import { dbInit } from "~/lib/db";
import { entries } from "shared/lib/objects";
import { renderToString } from "react-dom/server";
import { Route } from "./models/Route";
import { Schedule } from "~/models/Schedule";
import { scheduleJob } from "node-schedule";
import { sendNotFound, sendResponse } from "~/lib/api";
import { StaticRouter } from "react-router-dom/server";
import { Terminal } from "~/models/Terminal";
import { Terminal as TerminalClass } from "shared/contracts/terminals";
import { toWsfDate } from "./lib/wsf/date";
import { updateEstimates } from "./lib/forecast";
import { updateLong, updateShort } from "~/lib/wsf";
import { updateSchedules } from "./lib/wsf/updateSchedules";
import { Vessel } from "~/models/Vessel";
import { Vessel as VesselClass } from "shared/contracts/vessels";
import bodyParser from "koa-bodyparser";
import compress from "koa-compress";
import fs from "fs";
import Koa from "koa";
import logger from "heroku-logger";
import mount from "koa-mount";
import path from "path";
import React from "react";
import requestLogger from "koa-logger";
import Router from "koa-router";
import serve from "koa-static";
import sslify, { xForwardedProtoResolver } from "koa-sslify";

// start main app
const app = new Koa();
// use SSL in production
if (process.env.NODE_ENV === "production") {
  app.use(sslify({ resolver: xForwardedProtoResolver }));
}
// log requests
app.use(requestLogger());

// create Koa app to serve API
const api = new Koa();
api.use(bodyParser());
const router = new Router();

// vessels
router.get("/vessels", async (context) => {
  const vessels = await Vessel.getAll();
  const results: Record<string, VesselClass> = {};
  entries(vessels).forEach(([key, vessel]) => {
    results[key] = vessel.serialize();
  });
  sendResponse(context, results);
});
router.get("/vessels/:vesselId", async (context) => {
  const { vesselId } = context.params;
  const vessel = await Vessel.getByIndex(vesselId);
  if (vessel) {
    sendResponse(context, vessel.serialize());
  } else {
    sendNotFound(context);
  }
});

// terminals
router.get("/terminals", async (context) => {
  const terminals = await Terminal.getAll();
  const results: Record<string, TerminalClass> = {};
  entries(terminals).forEach(([key, terminal]) => {
    results[key] = terminal.serialize();
  });
  sendResponse(context, results);
});
router.get("/terminals/:terminalId", async (context) => {
  const { terminalId } = context.params;
  const terminal = await Terminal.getByIndex(terminalId);
  if (terminal) {
    sendResponse(context, terminal.serialize());
  } else {
    sendNotFound(context);
  }
});

// schedule
router.get("/schedule/:departingId/:arrivingId/:date*", async (context) => {
  const { departingId, arrivingId, date: dateInput } = context.params;
  const date = dateInput || toWsfDate();
  if (!Schedule.hasFetchedDate(date)) {
    await updateSchedules(date);
    await updateEstimates();
  }
  const schedule = await Schedule.getByIndex(
    Schedule.generateKey(departingId, arrivingId, date)
  );
  if (schedule) {
    sendResponse(context, {
      schedule: schedule.serialize(),
      timestamp: DateTime.local().toSeconds(),
    });
  } else {
    sendNotFound(context);
  }
});

api.use(router.routes());
api.use(router.allowedMethods());
app.use(mount("/api", api));

// create Koa app to serve static files
const dist = new Koa();
dist.use(compress());
const clientDist = path.resolve(
  __dirname,
  "../",
  process.env.NODE_ENV === "development" ? "dist/" : "",
  "client/"
);
dist.use(serve(clientDist, { hidden: true }));
const browser = new Router();
browser.get("/robots.txt", (context) => {
  context.type = "text/plain";
  context.body = "User-agent: *\nAllow: /";
});
browser.get(/.*/, (context) => {
  const app = renderToString(
    <StaticRouter location={context.path}>
      <App />
    </StaticRouter>
  );
  fs.readFile(
    path.resolve(clientDist, "index.html"),
    { encoding: "utf8" },
    (error, index) => {
      context.type = "html";
      context.body = index.replace(
        'id="root"></div>',
        `'id="root">${app}</div>'`
      );
    }
  );
});
dist.use(browser.routes());
app.use(mount("/", dist));

// start server
(async () => {
  await dbInit;
  // start server before initializing WSF since that can take a couple minutes
  app.listen(process.env.PORT, () => logger.info("Server started"));
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
