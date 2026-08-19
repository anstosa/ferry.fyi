import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// mock route dependencies
const auth = vi.hoisted(() => ({ requireAuth: vi.fn() }));
const checkinModel = vi.hoisted(() => ({ create: vi.fn(), findOne: vi.fn() }));
const database = vi.hoisted(() => ({ transaction: vi.fn() }));
// isolate unrelated automatic enrollment routes
const enrollmentService = vi.hoisted(() => ({
  acknowledgeAutomaticEnrollmentRotation: vi.fn(),
  AutomaticEnrollmentError: class AutomaticEnrollmentError extends Error {},
  createAutomaticEnrollment: vi.fn(),
  listAutomaticEnrollments: vi.fn(),
  parseAutomaticEnrollmentBootstrapRequest: vi.fn(),
  parseAutomaticEnrollmentHealthUpdate: vi.fn(),
  parseAutomaticEnrollmentRotationRequest: vi.fn(),
  revokeAutomaticEnrollment: vi.fn(),
  rotateAutomaticEnrollmentCredential: vi.fn(),
  updateAutomaticEnrollmentHealth: vi.fn(),
}));
const flags = vi.hoisted(() => ({ leaderboardsEnabledForSubject: vi.fn() }));
// share policy mocks
const policy = vi.hoisted(() => ({
  evaluateLeaderboardAutomaticPolicy: vi.fn(),
  lockLeaderboardAutomaticPolicy: vi.fn(),
}));
const privacy = vi.hoisted(() => ({ anonymizeLeaderboardAccount: vi.fn() }));
const profileModel = vi.hoisted(() => ({ findOrCreate: vi.fn() }));
const publicLeaderboards = vi.hoisted(() => ({
  getPublicLeaderboard: vi.fn(),
  parsePublicLeaderboardPeriod: vi.fn(),
  publicLeaderboardsEnabled: vi.fn(),
}));
const routeModel = vi.hoisted(() => ({ getByTerminalId: vi.fn() }));
const scheduleModel = vi.hoisted(() => ({ getAll: vi.fn() }));
const terminalModel = vi.hoisted(() => ({
  getAll: vi.fn(),
  getByIndex: vi.fn(),
}));
const terminalPresenceModel = vi.hoisted(() => ({
  findOne: vi.fn(),
  findOrCreate: vi.fn(),
}));
const vesselModel = vi.hoisted(() => ({
  getAll: vi.fn(),
  getByIndex: vi.fn(),
  getOrCreate: vi.fn(),
}));
const wsfApi = vi.hoisted(() => ({ wsfRequest: vi.fn() }));

vi.mock("heroku-logger", () => ({ default: { info: vi.fn() } }));
vi.mock("../../server/controllers/api/auth", () => auth);
vi.mock("~/lib/db", () => ({ db: database }));
vi.mock("~/lib/leaderboardFlags", () => flags);
// bind policy mocks
vi.mock("~/lib/leaderboardAutomaticPolicy", () => policy);
vi.mock("~/lib/leaderboardPrivacy", () => privacy);
// bind the server helper alias
vi.mock("~/lib/leaderboards", () => import("../../server/lib/leaderboards"));
vi.mock("~/lib/noaaCoastline", () => ({
  evaluateOffshoreEligibility: vi.fn(() => ({
    eligible: true,
    shoreDistanceMeters: 500,
  })),
}));
vi.mock("~/lib/wsf/api", () => wsfApi);
vi.mock("~/models/LeaderboardCheckin", () => ({
  LeaderboardCheckin: checkinModel,
}));
vi.mock("~/models/LeaderboardProfile", () => ({
  LeaderboardProfile: profileModel,
}));
vi.mock("~/models/LeaderboardTerminalPresence", () => ({
  LeaderboardTerminalPresence: terminalPresenceModel,
}));
vi.mock("~/models/Route", () => ({ Route: routeModel }));
vi.mock("~/models/Schedule", () => ({ Schedule: scheduleModel }));
vi.mock("~/models/Terminal", () => ({ Terminal: terminalModel }));
vi.mock("~/models/Vessel", () => ({ Vessel: vesselModel }));
vi.mock("~/services/leaderboardAutomaticEnrollment", () => enrollmentService);
vi.mock("~/services/public/leaderboards", () => publicLeaderboards);

import { leaderboardRouter } from "../../server/controllers/api/leaderboards";
import {
  type LiveVesselForCheckin,
  stableSailingId,
} from "../../server/lib/leaderboards";
import { updateVesselStatus } from "../../server/lib/wsf/updateVessels";

const nowMs = Math.floor(Date.now() / 1000) * 1000;
const nowSeconds = nowMs / 1000;

interface HydratedTestVessel extends LiveVesselForCheckin {
  departureDelta: number;
  info: Record<string, unknown>;
  save: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

// format real WSF timestamps
const wsfDate = (epochSeconds: number): string =>
  `/Date(${epochSeconds * 1000}-0700)/`;

// mount the authenticated route
const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/leaderboards", leaderboardRouter);
  // expose route failures
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      response.status(599).send({
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  );
  return app;
};

describe("manual vessel check-ins from WSF status", () => {
  let checkinCreated: boolean;
  let liveVessel: HydratedTestVessel;

  // hydrate a real-source vessel
  beforeEach(() => {
    vi.clearAllMocks();
    checkinCreated = false;
    liveVessel = {
      arrivingTerminalId: 0,
      departureDelta: 0,
      departedTime: 0,
      departingTerminalId: 0,
      id: "123",
      inService: true,
      info: {},
      isAtDock: false,
      location: { latitude: 0, longitude: 0 },
      save: vi.fn(),
      statusUpdatedAt: 0,
      update: vi.fn(),
    };
    // apply hydrated vessel fields
    liveVessel.update = vi.fn((data: Record<string, unknown>) => {
      Object.assign(liveVessel, data);
    });
    // attach the test subject
    auth.requireAuth.mockImplementation((_request, response, next) => {
      response.locals.user = { sub: "auth0|tester" };
      next();
    });
    flags.leaderboardsEnabledForSubject.mockResolvedValue(true);
    scheduleModel.getAll.mockReturnValue({});
    terminalModel.getAll.mockReturnValue({});
    vesselModel.getByIndex.mockReturnValue(liveVessel);
    profileModel.findOrCreate.mockResolvedValue([
      {
        notificationsEnabled: false,
        optedOut: false,
        reload: vi.fn(),
      },
    ]);
    policy.evaluateLeaderboardAutomaticPolicy.mockReturnValue({
      manualEnabled: true,
    });
    policy.lockLeaderboardAutomaticPolicy.mockResolvedValue({
      profile: {
        notificationsEnabled: false,
        optedOut: false,
      },
    });
    // replay existing credit state
    checkinModel.findOne.mockImplementation(() =>
      Promise.resolve(checkinCreated ? { id: "existing" } : null)
    );
    // record the first credit
    checkinModel.create.mockImplementation(() => {
      checkinCreated = true;
      return Promise.resolve({ id: "created" });
    });
    // execute transactions inline
    database.transaction.mockImplementation((callback) =>
      callback({ LOCK: { UPDATE: "UPDATE" } })
    );
    wsfApi.wsfRequest.mockResolvedValue([
      {
        ArrivingTerminalID: 2,
        AtDock: false,
        DepartingTerminalID: 1,
        Eta: wsfDate(nowSeconds + 20 * 60),
        EtaBasis: "GPS",
        Heading: 270,
        Latitude: 47.6,
        LeftDock: wsfDate(nowSeconds - 60),
        Longitude: -122.4,
        Mmsi: 123456789,
        ScheduledDeparture: wsfDate(nowSeconds - 5 * 60),
        Speed: 12,
        VesselID: 123,
        VesselName: "Tokitae",
      },
    ]);
  });

  // protect the complete manual path
  it("credits a current WSF sailing once and rejects it when stale", async () => {
    await updateVesselStatus();

    expect(liveVessel.departedTime).toBe(nowSeconds - 60);
    expect(liveVessel.statusUpdatedAt).toBeGreaterThanOrEqual(nowMs);
    expect(liveVessel.statusUpdatedAt).toBeLessThan(nowMs + 60_000);
    const sailingId = stableSailingId(liveVessel, liveVessel.statusUpdatedAt);
    expect(sailingId).toBe(`123:${nowSeconds - 60}:1:2`);

    const body = {
      accuracyMeters: 10,
      latitude: liveVessel.location.latitude,
      longitude: liveVessel.location.longitude,
      observedAt: new Date(nowMs).toISOString(),
      sailingId,
      vesselId: "123",
    };
    const firstResponse = await request(createApp())
      .post("/leaderboards/checkins/vessels")
      .send(body);
    expect(firstResponse.status, JSON.stringify(firstResponse.body)).toBe(201);
    expect(firstResponse.body).toEqual({ credited: true, sailingId });
    await request(createApp())
      .post("/leaderboards/checkins/vessels")
      .send(body)
      .expect(200, {
        credited: false,
        reason: "SAILING_ALREADY_CREDITED",
        sailingId,
      });

    Object.assign(liveVessel, {
      departedTime: nowSeconds - 12 * 60 * 60 - 1,
    });
    await request(createApp())
      .post("/leaderboards/checkins/vessels")
      .send(body)
      .expect(422, {
        credited: false,
        reason: "UNKNOWN_OR_UNSTABLE_SAILING",
      });
    expect(checkinModel.create).toHaveBeenCalledOnce();
  });
});
