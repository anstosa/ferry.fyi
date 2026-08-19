/* eslint-disable require-await -- fixture services implement async production interfaces. */
import fs from "node:fs";
import https, { type Server } from "node:https";
import path from "node:path";

import {
  json,
  type RequestHandler,
  Router,
  static as serveStatic,
} from "express";
import type { PublicSsrRendererArtifact } from "shared/contracts/ssrRenderer";
import type { Terminal } from "shared/contracts/terminals";

import { createStaticRouter } from "../../server/controllers/static";
import { createApp } from "../../server/server";
import { SsrArtifacts } from "../../server/ssr/artifacts";
import { createSsrConfig } from "../../server/ssr/config";
import { SsrDocumentCache } from "../../server/ssr/documentCache";
import {
  createSsrDocumentRuntime,
  type SsrRuntimeFill,
  type SsrTelemetryEvent,
} from "../../server/ssr/documentRuntime";
import {
  createPublicSsrCanonicalResolver,
  createPublicSsrSnapshotLoader,
  type PublicSsrSnapshotServices,
} from "../../server/ssr/publicSnapshot";

const port = Number(process.env.PORT ?? "4177");
const distributionDirectory = path.resolve(__dirname, "..");
const certificateDirectory = path.resolve(
  distributionDirectory,
  "..",
  "tests/e2e/certs"
);
const clientDirectory = path.join(distributionDirectory, "client");
const rendererPath = path.join(
  distributionDirectory,
  "ssr",
  "entry-server.mjs"
);
const artifacts = new SsrArtifacts({ clientDirectory, rendererPath });

type FixtureState = {
  advanceAfterLoadTo: string | null;
  cacheEnabled: boolean;
  clock: Date;
  documentsEnabled: boolean;
  failLoads: number;
  failRenders: number;
  fills: number;
  refreshVersion: number;
  requests: number;
  telemetry: SsrTelemetryEvent[];
};

const initialClock = "2026-07-29T09:59:59.000Z";
const state: FixtureState = {
  advanceAfterLoadTo: null,
  cacheEnabled: process.env.SSR_DOCUMENT_CACHE_ENABLED !== "false",
  clock: new Date(initialClock),
  documentsEnabled: process.env.SSR_DOCUMENTS_ENABLED !== "false",
  failLoads: 0,
  failRenders: 0,
  fills: 0,
  refreshVersion: 1,
  requests: 0,
  telemetry: [],
};

const identity = (id: string, name: string) => ({
  abbreviation: name.slice(0, 3).toUpperCase(),
  id,
  name,
});

const fixtureTerminalName = (terminalId: string): string => {
  switch (terminalId) {
    case "3":
      return "Bainbridge";
    case "7":
      return "Seattle";
    case "14":
      return "Mukilteo";
    default:
      return "Clinton";
  }
};

const makeTerminal = (
  id: string,
  name: string,
  mateIds: readonly string[],
  options: { camera?: boolean } = {}
): Terminal =>
  ({
    abbreviation: name.slice(0, 3).toUpperCase(),
    bulletins: [
      {
        bodyHTML: "<p>Fixture terminal notice</p>",
        bodyText: "Fixture terminal notice",
        date: 1_775_000_000,
        level: "info",
        routePrefix: "fixture",
        terminalId: id,
        title: "Fixture service alert",
      },
    ],
    cameras: options.camera
      ? [
          {
            carCapacity: 20,
            carsToBoat: 5,
            id: `camera-${id}`,
            image: {
              height: 360,
              url: "/static/images/social.png",
              width: 640,
            },
            isActive: true,
            location: { latitude: 47.6, longitude: -122.3 },
            orderFromTerminal: 1,
            owner: null,
            terminalId: id,
            title: `${name} holding area`,
          },
        ]
      : [],
    hasElevator: true,
    hasFood: true,
    hasOverheadLoading: false,
    hasRestroom: true,
    hasWaitingRoom: true,
    id,
    info: {},
    location: {
      address: {
        city: name,
        line1: "1 Ferry Dock",
        state: "WA",
        zip: "98101",
      },
      latitude: 47.6,
      longitude: -122.3,
    },
    mates: mateIds.map((mateId) =>
      identity(mateId, fixtureTerminalName(mateId))
    ),
    name,
    popularity: 1,
    routes: {
      [id === "3" || id === "7" ? "5" : "7"]: {
        abbreviation: "FIX",
        averageVehicleCapacity: 100,
        crossingTime: 35,
        date: "2026-07-29",
        description: `${name} fixture route`,
        id: id === "3" || id === "7" ? "5" : "7",
        terminalIds: [id, ...mateIds],
      },
    },
    terminalUrl: "https://wsdot.wa.gov/ferries",
    vesselWatchUrl: "https://wsdot.wa.gov/ferries/vesselwatch",
    waitTimes: [],
  }) as Terminal;

const terminals = (): Record<string, Terminal> => ({
  "3": makeTerminal("3", "Bainbridge", ["7"]),
  "5": makeTerminal("5", "Clinton", ["14"]),
  "7": makeTerminal(
    "7",
    state.refreshVersion > 1 ? "Seattle refreshed" : "Seattle",
    ["3"],
    { camera: true }
  ),
  "14": makeTerminal("14", "Mukilteo", ["5"]),
});

const schedule = (departingId: string, arrivingId: string, date: string) => {
  const sourceTime = Math.floor(state.clock.getTime() / 1000);
  const departureTime = sourceTime + 3_600 + state.refreshVersion * 60;
  return {
    schedule: {
      date,
      key: `${departingId}-${arrivingId}-${date}`,
      mateId: arrivingId,
      slots: [
        {
          allowsPassengers: true,
          allowsVehicles: true,
          crossing: {
            arrivalId: arrivingId,
            departureDelta: 0,
            departureId: departingId,
            departureTime,
            driveUpCapacity: 77 - state.refreshVersion,
            hasDriveUp: true,
            hasReservations: false,
            isCancelled: false,
            reservableCapacity: 0,
            totalCapacity: 100,
            vesselId: "fixture-vessel",
            vesselName: "Fixture Ferry",
          },
          estimate: {
            confidence: "high",
            driveUpCapacity: 77 - state.refreshVersion,
            reservableCapacity: null,
          },
          hasPassed: false,
          mateId: arrivingId,
          time: departureTime,
          vessel: {
            abbreviation: "FIX",
            beam: "75",
            classId: "fixture",
            hasCarDeckRestroom: true,
            hasElevator: true,
            hasGalley: false,
            hasRestroom: true,
            hasWiFi: true,
            horsepower: 1,
            id: "fixture-vessel",
            inMaintenance: false,
            inService: true,
            info: {},
            isAdaAccessible: true,
            maxClearance: 15,
            name: "Fixture Ferry",
            passengerCapacity: 1_000,
            speed: 12,
            tallVehicleCapacity: 10,
            vehicleCapacity: 100,
            vesselWatchUrl: "",
            weight: 1,
            yearBuilt: 2000,
            yearRebuilt: 2000,
          },
          wuid: `fixture-${state.refreshVersion}`,
        },
      ],
      sourceUpdatedAt: sourceTime,
      terminalId: departingId,
      validRange: null,
    },
    status: "available" as const,
    timestamp: sourceTime,
  };
};

const services: PublicSsrSnapshotServices = {
  getAdCreative: async () => null,
  getCameraFrames: async (cameraIds) => ({
    frames: Object.fromEntries(
      cameraIds.map((cameraId) => [
        cameraId,
        {
          cameraId,
          checkedAt: Math.floor(state.clock.getTime() / 1000),
          error: null,
          frameToken: `fixture-${state.refreshVersion}`,
          frameUpdatedAt: Math.floor(state.clock.getTime() / 1000),
          imageUrl: "/static/images/social.png",
          isStale: false,
        },
      ])
    ),
    sourceUpdatedAt: Math.floor(state.clock.getTime() / 1000),
  }),
  getContent: async () => ({
    announcements: [
      {
        body: `Fixture public update ${state.refreshVersion}`,
        id: "fixture-notice",
        title: "Fixture service update",
      },
    ],
    crawlerPolicy: { aiCrawlers: "allow", disallowPaths: [] },
    leaderboardIndexingEnabled: true,
    leaderboardSharingEnabled: true,
    maintenance: { enabled: false, message: "" },
  }),
  getFareCatalog: async (request) => ({
    catalog: {
      collectionDescription: "Fixture fare collection",
      fares: [
        {
          amount: 9.85,
          category: "Passenger",
          directionIndependent: false,
          id: 1,
          label: "Adult passenger",
        },
      ],
      freshness: {
        fetchedAt: Math.floor(state.clock.getTime() / 1000),
        policyVersion: "fixture",
        sourceCacheFlushDate: "fixture",
        validFrom: "2026-01-01",
        validThrough: "2026-12-31",
      },
      kind: "catalog",
      request,
    },
    kind: "catalog",
  }),
  getLeaderboard: async ({ entityId, period }) => ({
    entityId,
    period,
    ranks: [{ label: "Fixture rider", rank: 1, score: 42 }],
  }),
  getPublicLeaderboardsEnabled: async () => true,
  getSchedule: async ({ arrivingId, date, departingId }) =>
    schedule(departingId, arrivingId, date),
  getTerminals: async () => terminals(),
  getVessels: async () => ({
    "fixture-vessel": {
      abbreviation: "FIX",
      heading: 90,
      id: "fixture-vessel",
      inMaintenance: false,
      inService: true,
      isAtDock: false,
      location: { latitude: 47.61, longitude: -122.31 },
      name: "Fixture Ferry",
      speed: 12,
    },
  }),
  getWsfStatus: async () => ({ coreReady: true, offline: false }),
};

let runtime: Awaited<ReturnType<typeof makeRuntime>>;
const startupConfig = {
  cacheEnabled: state.cacheEnabled,
  documentsEnabled: state.documentsEnabled,
};

const makeRuntime = async () => {
  const [baseRenderer, template] = await Promise.all([
    artifacts.getRenderer(),
    artifacts.getTemplate(),
  ]);
  const renderer: PublicSsrRendererArtifact = {
    ...baseRenderer,
    async renderPublicSsrDocument(input) {
      if (state.failRenders > 0) {
        state.failRenders -= 1;
        throw new Error("fixture-render-failure");
      }
      return baseRenderer.renderPublicSsrDocument(input);
    },
  };
  const snapshotLoader = createPublicSsrSnapshotLoader({ services });
  return createSsrDocumentRuntime({
    cache: new SsrDocumentCache<SsrRuntimeFill>(),
    clock: () => new Date(state.clock),
    config: createSsrConfig({
      SSR_DOCUMENT_CACHE_ENABLED: String(state.cacheEnabled),
      SSR_DOCUMENTS_ENABLED: String(state.documentsEnabled),
    }),
    contentRevision: () => "fixture-content",
    load: async (input) => {
      state.fills += 1;
      if (state.failLoads > 0) {
        state.failLoads -= 1;
        throw new Error("fixture-load-failure");
      }
      const result = await snapshotLoader(input);
      if (state.advanceAfterLoadTo) {
        state.clock = new Date(state.advanceAfterLoadTo);
      }
      return result;
    },
    release: () => ({
      publishedAt: "2026-07-29T00:00:00.000Z",
      version: "fixture-release",
    }),
    renderer,
    resolve: createPublicSsrCanonicalResolver({
      getTerminals: services.getTerminals,
    }),
    telemetry: (event) => state.telemetry.push(event),
    template,
  });
};

const fixtureRouter = Router();
fixtureRouter.use(json());
// serve the dedicated production-component browser fixture
fixtureRouter.use(
  "/__automatic__",
  serveStatic(path.join(distributionDirectory, "e2e/automatic-checkins"))
);
fixtureRouter.get("/__fixture__/health", (_request, response) =>
  response.json({ ok: true })
);
fixtureRouter.get("/__fixture__/state", (_request, response) =>
  response.json({ ...state, clock: state.clock.toISOString() })
);
fixtureRouter.post("/__fixture__/reset", async (_request, response) => {
  Object.assign(state, {
    advanceAfterLoadTo: null,
    cacheEnabled: startupConfig.cacheEnabled,
    clock: new Date(initialClock),
    documentsEnabled: startupConfig.documentsEnabled,
    failLoads: 0,
    failRenders: 0,
    fills: 0,
    refreshVersion: 1,
    requests: 0,
    telemetry: [],
  });
  runtime = await makeRuntime();
  response.json({ ok: true });
});
fixtureRouter.post("/__fixture__/control", async (request, response) => {
  const input = request.body as Partial<{
    advanceAfterLoadTo: string | null;
    clock: string;
    failLoads: number;
    failRenders: number;
    refreshVersion: number;
  }>;
  if (typeof input.clock === "string") {
    state.clock = new Date(input.clock);
  }
  if (input.advanceAfterLoadTo !== undefined) {
    state.advanceAfterLoadTo = input.advanceAfterLoadTo;
  }
  if (input.failLoads !== undefined) {
    state.failLoads = input.failLoads;
  }
  if (input.failRenders !== undefined) {
    state.failRenders = input.failRenders;
  }
  if (input.refreshVersion !== undefined) {
    state.refreshVersion = input.refreshVersion;
  }
  response.json({ ok: true });
});
const apiRouter = Router();
// keep browser hydration aligned with the public leaderboard fixture
apiRouter.get("/features", (_request, response) =>
  response.json({ leaderboardsEnabled: true })
);
apiRouter.all("/schedule/:departing/:arriving/:date", (request, response) => {
  const { arriving, date, departing } = request.params;
  response.json({
    body: schedule(departing, arriving, date),
    wsfStatus: { coreReady: true, offline: false },
  });
});
apiRouter.get("/terminals", (_request, response) =>
  response.json({
    body: terminals(),
    wsfStatus: { coreReady: true, offline: false },
  })
);
apiRouter.get("/terminals/:id", (request, response) =>
  response.json({
    body: terminals()[request.params.id],
    wsfStatus: { coreReady: true, offline: false },
  })
);
apiRouter.use((_request, response) => {
  response.set({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, noarchive",
  });
  response.status(404).json({
    body: { error: "api_not_found" },
    wsfStatus: { coreReady: true, offline: false },
  });
});
const noRateLimit: RequestHandler = (_request, _response, next) => next();
const fixturePolicyRouter = Router();
fixturePolicyRouter.get("/sitemap.xml", (_request, response) =>
  response
    .type("text/xml")
    .send(
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://ferry.fyi/</loc></url></urlset>'
    )
);
const staticRouter = createStaticRouter(clientDirectory, {
  browserDependencies: {
    documentRuntime: async (url) => {
      state.requests += 1;
      return runtime(url);
    },
  },
  rateLimiter: noRateLimit,
});
const fixtureApp = createApp({
  apiHandler: apiRouter,
  publicMiddleware: fixturePolicyRouter,
  staticHandler: staticRouter,
  webMiddleware: fixtureRouter,
});

let server: Server | undefined;
const start = async () => {
  runtime = await makeRuntime();
  server = https
    .createServer(
      {
        cert: fs.readFileSync(path.join(certificateDirectory, "ferry-fyi.crt")),
        key: fs.readFileSync(path.join(certificateDirectory, "ferry-fyi.key")),
      },
      fixtureApp
    )
    .listen(port, "0.0.0.0");
};

const stop = () => server?.close();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
start().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
