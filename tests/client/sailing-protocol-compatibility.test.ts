import express from "express";
import type { SailingRecommendationRequest } from "shared/contracts/sailingRecommendations";
import type { Schedule, Slot } from "shared/contracts/schedules";
import { getRecommendationServiceDate } from "shared/lib/sailingRecommendationRevision";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../client/lib/api";
import { getSailingRecommendation } from "../../client/lib/sailingRecommendations";
import { createSailingRecommendationRouter } from "../../server/controllers/api/sailingRecommendations";
import type { FillTimingObservation } from "../../server/lib/fillTiming";
import { getSailingRecommendationRevision as legacyRevision } from "../fixtures/sailingRecommendationRevisionV1";
import { getSailingRecommendation as legacyRecommendation } from "../fixtures/sailingRecommendationsV1";

// isolate both request transport and paid-provider admission evidence
const transport = vi.hoisted(() => ({ post: vi.fn(), route: vi.fn() }));
vi.mock("../../client/lib/api", () => ({
  post: transport.post,
  ApiError: class extends Error {
    status: number;
    data: unknown;
    // retain the actual transport's normalized error shape
    constructor(status: number, data: unknown) {
      super("synthetic protocol request failed");
      this.status = status;
      this.data = data;
    }
  },
}));
vi.mock("../../server/lib/terminalLocations", () => ({
  terminalLocationService: { getBooth: vi.fn() },
}));

const NOW = 1_800_000_000;
const trip: SailingRecommendationRequest = {
  arrivingTerminalId: "5",
  bufferMinutes: 5,
  departingTerminalId: "14",
  mode: "drive",
  origin: { address: "Synthetic protocol origin", kind: "address" },
};

// keep the schedule public and deterministic without any real provider data
const makeSchedule = (): Schedule => ({
  date: getRecommendationServiceDate(NOW),
  key: "14-5-protocol",
  mateId: "5",
  terminalId: "14",
  validRange: null,
  slots: [40, 80].map((minutes) => ({
    allowsPassengers: true,
    allowsVehicles: true,
    estimate: {
      driveUpCapacity: 10,
      fullProbability: 0.1,
      reservableCapacity: null,
    },
    hasPassed: false,
    mateId: "5",
    time: NOW + minutes * 60,
    vessel: {
      id: "1",
      name: "Protocol vessel",
      vehicleCapacity: 100,
      tallVehicleCapacity: 0,
    },
    wuid: "protocol",
  })) as Slot[],
});

// provide current drive-up inventory for just the requested physical sailings
const observations = (schedule: Schedule): FillTimingObservation[] =>
  schedule.slots.map((slot) => ({
    departureTime: slot.time,
    driveUpDisplayed: true,
    driveUpSpaces: 30,
    isCancelled: false,
    maxSpaceCount: 100,
    receivedAt: NOW,
    reportingStateAtReceipt: "active",
    sourceKind: "wsf-direct",
    usableForFillLabel: true,
    vesselId: "1",
  }));

// exercise real HTTP routing through only the existing mocked client transport seam
const mount = (
  schedule: Schedule,
  inventory: FillTimingObservation[],
  legacyOnly = false
) => {
  const app = express();
  app.use(express.json());
  // emulate a previous task without opening any paid-provider route
  if (legacyOnly) {
    app.post("/api/sailing-recommendations/v2", (_request, response) => {
      // a previous task cannot serve the newly versioned endpoint
      response.sendStatus(404);
    });
  }
  transport.route.mockResolvedValue({
    ok: true,
    value: {
      durationSeconds: 600,
      routeRequestedAt: NOW,
      partialMatch: false,
      trafficAware: true,
      staticDurationSeconds: 600,
      warnings: [],
    },
  });
  app.use(
    "/api/sailing-recommendations",
    createSailingRecommendationRouter({
      admitCall: () => true,
      enabled: () => true,
      getAccessPoint: () => ({ latitude: 47.95, longitude: -122.3 }),
      // keep the provider seams asynchronous without any external calls
      getObservations: () => Promise.resolve(inventory),
      getRoute: transport.route,
      getSchedule: () => schedule,
      now: () => NOW,
      rateLimiter: (_request, _response, next) => next(),
      telemetry: () => undefined,
    })
  );
  transport.post.mockImplementation(async (path: string, body: object) => {
    const response = await request(app).post(`/api${path}`).send(body);
    // an absent protocol route must not masquerade as a usable response
    if (response.status !== 200) {
      throw new ApiError(response.status, response.body);
    }
    return response.body;
  });
  return app;
};

describe("previous production client and current recommendation server", () => {
  // align model and expiry clocks with the synthetic route snapshot
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW * 1000);
    vi.clearAllMocks();
  });

  // restore process time after each isolated wire-contract comparison
  afterEach(() => vi.useRealTimers());

  // run the exact old parser rather than approximating its strict key rules
  it("keeps a live v1 estimate acceptable to the prior production bundle", async () => {
    const schedule = makeSchedule();
    mount(schedule, observations(schedule));

    const response = await legacyRecommendation(trip);

    expect(response.revision).toBe(legacyRevision(schedule));
    expect(response.sailingAssessments?.[0].capacity).toMatchObject({
      observedSpacesAtAnchor: 30,
      state: "not-expected-before-departure",
    });
    expect(JSON.stringify(response)).not.toContain('"projection"');
    expect(JSON.stringify(response)).not.toContain('"forecastFullProbability"');
  });

  // retain unknown chances and the stronger later-live fallback for older callers
  it("preserves v1 unknown-capacity selection despite forecast fullness", async () => {
    const schedule = makeSchedule();
    mount(schedule, observations(schedule).slice(1));

    const response = await legacyRecommendation(trip);

    expect(response.revision).toBe(legacyRevision(schedule));
    expect(
      response.sailingAssessments?.[0].chance.capacityProbability
    ).toBeNull();
    expect(response.sailingAssessments?.[0].chance.probabilities).toEqual(
      Array(61).fill(null)
    );
    expect(response.outcome.sailing?.scheduledDepartureAt).toBe(
      schedule.slots[1].time
    );
  });

  // opt the current bundle into the extended contract without changing old callers
  it("uses v2 for current live projection and forecast-backed estimates", async () => {
    const schedule = makeSchedule();
    mount(schedule, observations(schedule).slice(1));

    const response = await getSailingRecommendation(trip);

    expect(transport.post).toHaveBeenCalledWith(
      "/sailing-recommendations/v2",
      trip
    );
    expect(
      response.sailingAssessments?.[0].chance.forecastFullProbability
    ).toBe(0.1);
    expect(response.sailingAssessments?.[0].chance.capacityProbability).toBe(
      0.9
    );
    expect(response.sailingAssessments?.[1].capacity?.projection).toBeDefined();
    expect(response.revision).not.toBe(legacyRevision(schedule));
    expect(response.outcome.sailing?.scheduledDepartureAt).toBe(
      schedule.slots[0].time
    );
  });

  // maintain estimates when a current bundle reaches a previous rolling task
  it("falls back once on a missing v2 route with only one provider call", async () => {
    const schedule = makeSchedule();
    mount(schedule, observations(schedule).slice(1), true);

    const response = await getSailingRecommendation(trip);

    expect(transport.post.mock.calls.map(([path]) => path)).toEqual([
      "/sailing-recommendations/v2",
      "/sailing-recommendations",
    ]);
    expect(transport.route).toHaveBeenCalledOnce();
    expect(response.protocolVersion).toBe("v1");
    expect(response.revision).toBe(legacyRevision(schedule));
    expect(response.outcome.sailing?.scheduledDepartureAt).toBe(
      schedule.slots[1].time
    );
    expect(
      response.sailingAssessments?.[0].chance.capacityProbability
    ).toBeNull();
  });

  // never duplicate an origin action after authorization or server failures
  it.each([401, 403, 500])(
    "does not retry a potentially billable request after HTTP %s",
    async (status) => {
      transport.post.mockRejectedValue(new ApiError(status, {}));

      await expect(getSailingRecommendation(trip)).rejects.toThrow(
        "Sailing estimate unavailable"
      );

      expect(transport.post).toHaveBeenCalledOnce();
    }
  );

  // preserve the quota result without another endpoint attempt
  it("does not downgrade after a quota rejection", async () => {
    transport.post.mockRejectedValue(new ApiError(429, {}));

    const response = await getSailingRecommendation(trip);

    expect(response.outcome.reason).toBe("provider-quota-unavailable");
    expect(transport.post).toHaveBeenCalledOnce();
  });

  // a timeout may follow billable work and must not trigger another estimate
  it("does not downgrade after an uncertain transport failure", async () => {
    transport.post.mockRejectedValue(new Error("synthetic timeout"));

    await expect(getSailingRecommendation(trip)).rejects.toThrow(
      "Sailing estimate unavailable"
    );

    expect(transport.post).toHaveBeenCalledOnce();
  });

  // preserve a legacy quota rejection after the single permitted downgrade
  it("stops after the fallback endpoint rejects the quota", async () => {
    transport.post
      .mockRejectedValueOnce(new ApiError(404, {}))
      .mockRejectedValueOnce(new ApiError(429, {}));

    const response = await getSailingRecommendation(trip);

    expect(response.protocolVersion).toBe("v1");
    expect(response.outcome.reason).toBe("provider-quota-unavailable");
    expect(transport.post).toHaveBeenCalledTimes(2);
  });

  // keep protocol dispatch consistent with express's accepted path variants
  it.each(["/v2", "/v2/", "/V2", "/V2/"])(
    "retains the v2 contract for the accepted %s path",
    async (suffix) => {
      const schedule = makeSchedule();
      const app = mount(schedule, observations(schedule).slice(1));

      const response = await request(app)
        .post(`/api/sailing-recommendations${suffix}`)
        .send(trip)
        .expect(200);

      expect(
        response.body.sailingAssessments[0].chance.forecastFullProbability
      ).toBe(0.1);
      expect(
        response.body.sailingAssessments[1].capacity.projection
      ).toBeDefined();
    }
  );
});
