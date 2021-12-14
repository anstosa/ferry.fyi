import { DateTime } from "luxon";
import { dbInit } from "~/lib/db";
import { entries } from "shared/lib/objects";
import { getSitemap, getTitle } from "./getSitemap";
import { Route } from "./models/Route";
import { Schedule } from "~/models/Schedule";
import { scheduleJob } from "node-schedule";
import { sendNotFound, sendResponse } from "~/lib/api";
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
  const today = DateTime.local().set({
    hour: 3,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  if (DateTime.fromISO(date).set({ hour: 12 }) < today) {
    return sendNotFound(context);
  }
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
browser.get(
  "/sitemap.xml",
  (context) =>
    new Promise<void>((resolve) =>
      getSitemap()
        .then((sitemap) => {
          context.type = "text/xml";
          context.body = sitemap;
          resolve();
        })
        .catch(() => {
          context.status = 500;
        })
    )
);
browser.get(/.*/, (context) => {
  // sync from webpack.config.ts
  const DEFAULT_TITLE = /Ferry FYI - Seattle Area Ferry Schedule and Tracker/g;

  let title: string | undefined;
  const terminalMatch = context.path.match(/^\/(\w+)\/?(\w*)\/?$/);
  if (terminalMatch) {
    const [, terminalSlug, mateSlug] = terminalMatch;
    const terminals: Terminal[] = entries(Terminal.getAll()).map(
      ([, terminal]) => terminal
    );
    const terminal = terminals.find(
      ({ slug, aliases }) =>
        slug === terminalSlug || aliases.includes(terminalSlug)
    );
    if (terminal) {
      const mate =
        terminals.find(
          ({ slug, aliases }) => slug === mateSlug || aliases.includes(mateSlug)
        ) || terminal.mates[0];

      const dateMatch = context.search.match(/date=([\d-]+)&?/);

      if (dateMatch) {
        const [, dateInput] = dateMatch;
        const date = DateTime.fromISO(dateInput);
        title = getTitle(terminal, mate, date);
      } else {
        title = getTitle(terminal, mate);
      }
    }
  }

  return new Promise<void>((resolve) => {
    fs.readFile(
      path.resolve(clientDist, "index.html"),
      { encoding: "utf-8" },
      (error, data) => {
        context.type = "html";
        context.body = title
          ? data
              .replace(DEFAULT_TITLE, title)
              .replace(
                `rel="canonical" href="${process.env.BASE_URL}"`,
                `rel="canonical" href="${process.env.BASE_URL}${context.path}"`
              )
          : data;
        resolve();
      }
    );
  });
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
