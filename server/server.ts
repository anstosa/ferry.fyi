import { createJob } from "~/lib/jobs";
import { DateTime } from "luxon";
import { dbInit } from "~/lib/db";
import { entries } from "shared/lib/objects";
import { Schedule } from "./models/Schedule";
import { Terminal } from "~/models/Terminal";
import { Terminal as TerminalClass } from "shared/models/terminals";
import { toWsfDate } from "./lib/wsf/date";
import { updateLong, updateShort } from "~/lib/wsf";
import { Vessel } from "~/models/Vessel";
import bodyParser from "koa-bodyparser";
import compress from "koa-compress";
import fs from "fs";
import Koa from "koa";
import logger from "heroku-logger";
import mount from "koa-mount";
import path from "path";
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
  context.body = await Vessel.getAll();
});
router.get("/vessels/:vesselId", async (context) => {
  const { vesselId } = context.params;
  const vessel = await Vessel.getByIndex(vesselId);
  if (vessel) {
    // eslint-disable-next-line require-atomic-updates
    context.body = vessel.serialize();
  } else {
    // eslint-disable-next-line require-atomic-updates
    context.status = 404;
  }
});

// terminals
router.get("/terminals", async (context) => {
  const terminals = await Terminal.getAll();
  const results: Record<string, TerminalClass> = {};
  entries(terminals).forEach(([key, terminal]) => {
    results[key] = terminal.serialize();
  });
  context.body = results;
});
router.get("/terminals/:terminalId", async (context) => {
  const { terminalId } = context.params;
  const terminal = await Terminal.getByIndex(terminalId);
  if (terminal) {
    // eslint-disable-next-line require-atomic-updates
    context.body = terminal.serialize();
  } else {
    // eslint-disable-next-line require-atomic-updates
    context.status = 404;
  }
});

// schedule
router.get("/schedule/:departingId/:arrivingId", async (context) => {
  const { departingId, arrivingId } = context.params;
  const schedule = await Schedule.getByIndex(
    Schedule.generateKey(departingId, arrivingId, toWsfDate())
  );
  if (schedule) {
    // eslint-disable-next-line require-atomic-updates
    context.body = {
      schedule: schedule.serialize(),
      timestamp: DateTime.local().toSeconds(),
    };
  } else {
    // eslint-disable-next-line require-atomic-updates
    context.status = 404;
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
  context.type = "html";
  context.body = fs.readFileSync(path.resolve(clientDist, "index.html"));
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
  // keep WSF cache up to date
  createJob(updateLong, 30 * 1000);
  createJob(updateShort, 10 * 1000);
  logger.info("WSF Initialized");
})();
