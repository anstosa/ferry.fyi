import express from "express";
import type { SailingRecommendationRequest } from "shared/contracts/sailingRecommendations";
import type { Schedule, Slot } from "shared/contracts/schedules";
import { getRecommendationServiceDate } from "shared/lib/sailingRecommendationRevision";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSailingRecommendationRouter } from "../../server/controllers/api/sailingRecommendations";
import type { FillTimingObservation } from "../../server/lib/fillTiming";
import type { GoogleRouteDestination } from "../../server/lib/googleRoutes";
import {
  classifyApiRequest,
  createApiCorsMiddleware,
  createApiRateLimitMiddleware,
  denyUntrustedPaidProviderOrigin,
} from "../../server/lib/httpApiPolicy";
import { createTravelUncertainty } from "../../server/lib/sailingChance";
import {
  buildRecommendationBands,
  buildSailingAssessments,
} from "../../server/lib/sailingRecommendations";
import {
  createRecommendationCallLimiter,
  createSailingRecommendationService,
  parseSailingRecommendationRequest,
} from "../../server/services/public/sailingRecommendations";

vi.mock("~/lib/wsf/api", () => ({ getWsfStatus: () => ({ offline: false }) }));
const locations = vi.hoisted(() => ({ getBooth: vi.fn() }));
vi.mock("~/lib/terminalLocations", () => ({
  terminalLocationService: locations,
}));
const NOW = 1_800_000_000;
const point: GoogleRouteDestination = {
  latitude: 47.95,
  longitude: -122.3,
};
const trip: SailingRecommendationRequest = {
  arrivingTerminalId: "5",
  bufferMinutes: 5,
  departingTerminalId: "14",
  mode: "drive",
  origin: { address: "Synthetic test origin", kind: "address" },
};

// create two future synthetic sailings without rider history
const makeSchedule = (): Schedule => ({
  date: getRecommendationServiceDate(NOW),
  key: "14-5-test",
  mateId: "5",
  terminalId: "14",
  validRange: null,
  slots: [40, 80].map((minutes) => {
    // construct a future vehicle and passenger slot
    return {
      allowsPassengers: true,
      allowsVehicles: true,
      estimate: { driveUpCapacity: 10, reservableCapacity: null },
      hasPassed: false,
      mateId: "5",
      time: NOW + minutes * 60,
      vessel: {
        id: "1",
        name: "Test vessel",
        vehicleCapacity: 100,
        tallVehicleCapacity: 0,
      },
      wuid: "test",
    } as Slot;
  }),
});

// construct a direct reporting anchor for each synthetic sailing
const makeObservations = (schedule: Schedule): FillTimingObservation[] =>
  schedule.slots.map((slot) => {
    // separate drive-up inventory from reservations
    return {
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
    };
  });

// freeze wall-clock helpers used by projected timing
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});
// release synthetic clocks between tests
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("leave-now sailing recommendations", () => {
  // assess every adjacent sailing from its own forecast without fresh inventory
  it.each(["missing", "stale"])(
    "uses forecasts for all driver chances with %s reports",
    (kind) => {
      const schedule = makeSchedule();
      schedule.slots.push({ ...schedule.slots[1], time: NOW + 120 * 60 });
      schedule.slots.forEach((slot, index) => {
        // retain independent forecast risks across the result neighborhood
        slot.estimate = {
          driveUpCapacity: 10,
          reservableCapacity: null,
          fullProbability: [0.2, 0.6, 0.1][index],
        };
      });
      const input = {
        arrivalAt: NOW + 20 * 60,
        asOf: NOW,
        mode: "drive" as const,
        schedule,
        observations:
          kind === "missing"
            ? []
            : makeObservations(schedule).map((row) => ({
                ...row,
                receivedAt: NOW - 181,
              })),
      };
      const bands = buildRecommendationBands(input);
      const assessments = buildSailingAssessments({
        ...input,
        bands,
        travelUncertainty: createTravelUncertainty({
          durationSeconds: 1200,
          mode: "drive",
          routeRequestedAt: NOW,
          trafficAware: true,
        }),
      });
      expect(assessments).toHaveLength(3);
      expect(
        assessments.map((sailing) => sailing.chance.probabilities[5])
      ).toEqual([0.8, 0.4, 0.9]);
      expect(
        assessments.map((sailing) => sailing.chance.forecastFullProbability)
      ).toEqual([0.2, 0.6, 0.1]);
      expect(
        assessments.every(
          (sailing) => sailing.capacity?.state === "unavailable"
        )
      ).toBe(true);
      expect(bands[0].outcome.sailing?.scheduledDepartureAt).toBe(
        schedule.slots[0].time
      );
    }
  );

  // confirmed live departure outranks delayed projections and favorable forecasts
  it.each(["drive", "walk", "bicycle", "transit"] as const)(
    "hard-zeroes a GPS-matched departed %s sailing",
    (mode) => {
      const schedule = makeSchedule();
      schedule.slots[0].time = NOW + 60;
      schedule.slots[0].estimate!.fullProbability = 0;
      schedule.slots[0].vessel = {
        ...schedule.slots[0].vessel,
        isAtDock: false,
        gpsDelay: {
          delaySeconds: 1200,
          signals: { scheduledDepartureTime: schedule.slots[0].time },
        },
      } as Slot["vessel"];
      const input = {
        arrivalAt: NOW + 120,
        asOf: NOW,
        mode,
        schedule,
        observations: [],
      };
      const bands = buildRecommendationBands(input);
      const assessment = buildSailingAssessments({
        ...input,
        bands,
        travelUncertainty: createTravelUncertainty({
          durationSeconds: 120,
          mode,
          routeRequestedAt: NOW,
          trafficAware: true,
        }),
      })[0];
      expect(assessment.eligibilityReason).toBe("departed");
      expect(assessment.chance.probabilities).toEqual(Array(61).fill(0));
      expect(assessment.chance.forecastFullProbability).toBeUndefined();
      expect(bands[0].outcome.skipped[0].reason).toBe("departed");
    }
  );

  // stale live flags and scheduled hasPassed cannot override a future delayed sailing
  it.each(["loading", "prior-leg", "future-event"])(
    "keeps a %s delayed sailing catchable",
    (kind) => {
      const schedule = makeSchedule();
      const slot = schedule.slots[0];
      slot.time = NOW - 60;
      slot.hasPassed = true;
      slot.estimate!.fullProbability = 0.2;
      const departureEvents: Record<string, number | undefined> = {
        loading: undefined,
        "prior-leg": slot.time - 11 * 60,
        "future-event": NOW + 10 * 60,
      };
      slot.vessel = {
        ...slot.vessel,
        scheduledDepartureTime: slot.time,
        isAtDock: kind === "loading",
        departedTime: departureEvents[kind],
        gpsDelay: {
          delaySeconds: 1200,
          signals: { scheduledDepartureTime: slot.time },
        },
      } as Slot["vessel"];
      const input = {
        arrivalAt: NOW + 120,
        asOf: NOW,
        mode: "drive" as const,
        schedule,
        observations: [],
      };
      const bands = buildRecommendationBands(input);
      const assessment = buildSailingAssessments({
        ...input,
        bands,
        travelUncertainty: createTravelUncertainty({
          durationSeconds: 120,
          mode: "drive",
          routeRequestedAt: NOW,
          trafficAware: true,
        }),
      })[0];
      expect(assessment.eligibilityReason).toBeNull();
      expect(assessment.chance.probabilities[5]).toBe(0.8);
      expect(bands[0].outcome.sailing?.scheduledDepartureAt).toBe(slot.time);
    }
  );

  // actual departure timestamps win over a later GPS projection for every method
  it.each(["drive", "walk", "bicycle", "transit"] as const)(
    "hard-zeroes actual %s departures with unknown capacity",
    (mode) => {
      // cover both exact-leg live events and persisted crossing events
      for (const source of ["live", "crossing"]) {
        const schedule = makeSchedule();
        const slot = schedule.slots[0];
        slot.time = NOW + 60;
        slot.estimate!.fullProbability = 0;
        slot.vessel = {
          ...slot.vessel,
          scheduledDepartureTime: slot.time,
          departedTime: source === "live" ? NOW - 60 : undefined,
          gpsDelay: {
            delaySeconds: 1200,
            signals: { scheduledDepartureTime: slot.time },
          },
        } as Slot["vessel"];
        // persist only the observed timestamp variant
        if (source === "crossing") {
          slot.crossing = {
            departureDelta: -120,
            isCancelled: false,
          } as Slot["crossing"];
        }
        const input = {
          arrivalAt: NOW + 120,
          asOf: NOW,
          mode,
          schedule,
          observations: [],
        };
        const bands = buildRecommendationBands(input);
        const assessment = buildSailingAssessments({
          ...input,
          bands,
          travelUncertainty: createTravelUncertainty({
            durationSeconds: 120,
            mode,
            routeRequestedAt: NOW,
            trafficAware: true,
          }),
        })[0];
        expect(assessment.eligibilityReason).toBe("departed");
        expect(assessment.chance.probabilities).toEqual(Array(61).fill(0));
        expect(bands[0].outcome.skipped[0].reason).toBe("departed");
      }
    }
  );

  // use the durable booth for every travel method without caller destination overrides
  it.each(["drive", "walk", "bicycle", "transit"] as const)(
    "routes %s to the saved booth",
    async (mode) => {
      const booth = { latitude: 47.6001, longitude: -122.3371 };
      locations.getBooth.mockResolvedValue(booth);
      const getRoute = vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "provider-unavailable" });
      const service = createSailingRecommendationService({
        enabled: () => true,
        getRoute,
        getSchedule: makeSchedule,
        now: () => NOW,
        telemetry: vi.fn(),
      });
      await service({ ...trip, mode });
      expect(locations.getBooth).toHaveBeenLastCalledWith("14");
      expect(getRoute).toHaveBeenCalledWith({ ...trip, mode }, booth);
    }
  );

  // unset or unavailable booth storage must not trigger a paid call
  it("fails closed for missing booths and storage errors", async () => {
    const getRoute = vi.fn();
    const telemetry = vi.fn();
    const service = createSailingRecommendationService({
      enabled: () => true,
      getRoute,
      telemetry,
    });
    locations.getBooth.mockResolvedValueOnce(null);
    expect((await service(trip)).outcome.reason).toBe(
      "configuration-unavailable"
    );
    locations.getBooth.mockRejectedValueOnce(
      new Error("sensitive database details")
    );
    expect((await service(trip)).outcome.reason).toBe(
      "configuration-unavailable"
    );
    expect(getRoute).not.toHaveBeenCalled();
    expect(telemetry.mock.calls[1][0]).toMatchObject({
      failureStage: "configuration",
      providerOutcome: "not-called",
    });
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain("sensitive");
  });

  // preserve the server-only kill switch before any location database access
  it("does not read booths while routing is disabled", async () => {
    locations.getBooth.mockClear();
    const service = createSailingRecommendationService({
      enabled: () => false,
      telemetry: vi.fn(),
    });
    await service(trip);
    expect(locations.getBooth).not.toHaveBeenCalled();
  });

  // accept only a selected google place id without retaining prediction text
  it("validates selected place origins at the request boundary", () => {
    const selected = {
      ...trip,
      origin: { kind: "place", placeId: "ChIJ_synthetic" },
    };
    expect(parseSailingRecommendationRequest(selected)).toEqual(selected);
    expect(
      parseSailingRecommendationRequest({
        ...selected,
        origin: { ...selected.origin, address: "extra text" },
      })
    ).toBeNull();
    expect(
      parseSailingRecommendationRequest({
        ...selected,
        origin: { kind: "place", placeId: "bad\nidentifier" },
      })
    ).toBeNull();
  });

  // validate exact request boundaries before paid work
  it("rejects extras, arbitrary routes, invalid origins and buffers", () => {
    expect(parseSailingRecommendationRequest(trip)).toEqual(trip);
    expect(
      parseSailingRecommendationRequest({ ...trip, destination: point })
    ).toBeNull();
    expect(
      parseSailingRecommendationRequest({ ...trip, bufferMinutes: 61 })
    ).toBeNull();
    expect(
      parseSailingRecommendationRequest({ ...trip, bufferMinutes: 1.5 })
    ).toBeNull();
    expect(
      parseSailingRecommendationRequest({ ...trip, departingTerminalId: "999" })
    ).toBeNull();
    expect(
      parseSailingRecommendationRequest({
        ...trip,
        origin: { kind: "coordinates", latitude: 0, longitude: 0 },
      })
    ).toBeNull();
    expect(
      parseSailingRecommendationRequest({
        ...trip,
        origin: { kind: "address", address: "bad\ninput" },
      })
    ).toBeNull();
  });
  // compare arrival capacity independently of buffer readiness
  it("covers every buffer and keeps arrival inventory invariant", () => {
    const schedule = makeSchedule();
    const bands = buildRecommendationBands({
      arrivalAt: NOW + 20 * 60,
      asOf: NOW,
      mode: "drive",
      observations: makeObservations(schedule),
      schedule,
    });
    const covered = bands.flatMap((band) =>
      Array.from(
        { length: band.maximumBufferMinutes - band.minimumBufferMinutes + 1 },
        (_, index) => band.minimumBufferMinutes + index
      )
    );
    expect(covered).toEqual(Array.from({ length: 61 }, (_, index) => index));
    expect(bands[0].outcome.sailing?.scheduledDepartureAt).toBe(
      schedule.slots[0].time
    );
    const later = bands.find((band) => band.minimumBufferMinutes === 18);
    expect(later?.outcome.sailing?.scheduledDepartureAt).toBe(
      schedule.slots[1].time
    );
    expect(bands[0].outcome.sailing?.capacity?.predictedSpacesAtArrival).toBe(
      20
    );
    expect(bands[0].outcome.sailing?.operatorCutoffSeconds).toBe(180);
  });

  // enforce the same three-minute cutoff in selection and chance timing
  it("uses the global boarding cutoff at the selection boundary", () => {
    const schedule = makeSchedule();
    const onCutoff = buildRecommendationBands({
      arrivalAt: schedule.slots[0].time - 180,
      asOf: NOW,
      mode: "walk",
      observations: [],
      schedule,
    })[0].outcome;
    const afterCutoff = buildRecommendationBands({
      arrivalAt: schedule.slots[0].time - 179,
      asOf: NOW,
      mode: "walk",
      observations: [],
      schedule,
    })[0].outcome;

    expect(onCutoff.sailing?.scheduledDepartureAt).toBe(schedule.slots[0].time);
    expect(afterCutoff.sailing?.scheduledDepartureAt).toBe(
      schedule.slots[1].time
    );
    expect(afterCutoff.skipped[0]).toEqual({
      departureAt: schedule.slots[0].time,
      reason: "too-late",
    });
  });
  // full vehicle inventory cannot disqualify walkers
  it("skips literal driver zero but not non-drivers or advisory-only timing", () => {
    const schedule = makeSchedule();
    const observations = makeObservations(schedule).map((row) => ({
      ...row,
      driveUpSpaces: 0,
    }));
    expect(
      buildRecommendationBands({
        arrivalAt: NOW + 60,
        asOf: NOW,
        mode: "drive",
        observations,
        schedule,
      })[0].outcome.result
    ).toBe("no-catchable-sailing");
    const walk = buildRecommendationBands({
      arrivalAt: NOW + 36 * 60,
      asOf: NOW,
      mode: "walk",
      observations,
      schedule,
    })[0].outcome;
    expect(walk.result).toBe("timing-only");
    expect(walk.sailing?.timingAssessment).toBe("tight");
    expect(walk.sailing?.capacity).toBeNull();
  });
  // isolate cancellation and confirmed departure evidence
  it("skips cancelled and observed-departed candidates", () => {
    const schedule = makeSchedule();
    schedule.slots[0].crossing = { isCancelled: true } as Slot["crossing"];
    expect(
      buildRecommendationBands({
        arrivalAt: NOW + 60,
        asOf: NOW,
        mode: "walk",
        observations: [],
        schedule,
      })[0].outcome.sailing?.scheduledDepartureAt
    ).toBe(schedule.slots[1].time);
  });
  // prove local concurrency cannot oversubscribe the process bucket
  it("admits thirty calls then refills without a monthly spend cap", () => {
    let clock = NOW;
    const admit = createRecommendationCallLimiter(() => clock);
    expect(
      Array.from({ length: 50 }, () => admit()).filter(Boolean)
    ).toHaveLength(30);
    clock += 2;
    expect(admit()).toBe(true);
    expect(admit()).toBe(false);
  });
  // make one provider call for the complete buffer result family
  it("composes causal expiry and normalized results without retaining an origin", async () => {
    const schedule = makeSchedule();
    const getRoute = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        durationSeconds: 1200,
        partialMatch: false,
        routeRequestedAt: NOW,
        trafficAware: true,
        warnings: [],
      },
    });
    const service = createSailingRecommendationService({
      enabled: () => true,
      getAccessPoint: () => point,
      getObservations: () => Promise.resolve(makeObservations(schedule)),
      getRoute,
      getSchedule: () => schedule,
      now: () => NOW,
    });
    const response = await service(trip);
    expect(getRoute).toHaveBeenCalledOnce();
    expect(response.arrivalAt).toBe(NOW + 1200);
    expect(response.validUntil).toBe(NOW + 120);
    expect(response.outcome.result).toBe("recommended");
    expect(JSON.stringify(response)).not.toContain("Synthetic test origin");
    expect(JSON.stringify(response)).not.toContain("latitude");
  });
  // preserve legacy selection, probabilities and nested capacity wire fields
  it("serves v1 without forecast behavior or capacity projections", async () => {
    const schedule = makeSchedule();
    schedule.slots[0].estimate!.fullProbability = 0.2;
    schedule.slots[1].estimate!.fullProbability = 0.1;
    const observations = makeObservations(schedule).slice(1);
    const service = createSailingRecommendationService({
      enabled: () => true,
      getAccessPoint: () => point,
      getObservations: () => Promise.resolve(observations),
      getRoute: () =>
        Promise.resolve({
          ok: true as const,
          value: {
            durationSeconds: 1200,
            partialMatch: false,
            routeRequestedAt: NOW,
            trafficAware: true,
            warnings: [],
          },
        }),
      getSchedule: () => schedule,
      now: () => NOW,
      telemetry: vi.fn(),
    });

    const current = await service(trip);
    const legacy = await service(trip, "v1");
    // locate the unknown-capacity legacy assessment
    const legacyUnknown = legacy.sailingAssessments?.find(
      (assessment) => assessment.scheduledDepartureAt === schedule.slots[0].time
    );

    expect(current.outcome.sailing?.scheduledDepartureAt).toBe(
      schedule.slots[0].time
    );
    expect(current.outcome.sailing?.capacity?.state).toBe("unavailable");
    expect(current.sailingAssessments?.[0].chance).toMatchObject({
      capacityProbability: 0.8,
      forecastFullProbability: 0.2,
    });
    expect(current.sailingAssessments?.[1].capacity?.projection).toBeDefined();
    expect(legacy.outcome.sailing?.scheduledDepartureAt).toBe(
      schedule.slots[1].time
    );
    expect(legacy.revision).not.toBe(current.revision);
    expect(legacyUnknown?.chance.capacityProbability).toBeNull();
    expect(legacyUnknown?.chance.probabilities).toEqual(Array(61).fill(null));
    expect(JSON.stringify(legacy)).not.toContain("forecastFullProbability");
    expect(JSON.stringify(legacy)).not.toContain("projection");
  });
  // return deduplicated neighbors and early tails from one route across every buffer
  it("builds bounded neighboring assessments for the complete buffer family", async () => {
    const schedule = makeSchedule();
    schedule.slots.push({
      ...schedule.slots[1],
      time: NOW + 120 * 60,
      wuid: "test-third",
    });
    schedule.slots[0].estimate = {
      driveUpCapacity: 0,
      reservableCapacity: null,
    };
    const getRoute = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        durationSeconds: 42 * 60,
        partialMatch: false,
        routeRequestedAt: NOW,
        staticDurationSeconds: 36 * 60,
        trafficAware: true,
        warnings: [],
      },
    });
    const service = createSailingRecommendationService({
      enabled: () => true,
      getAccessPoint: () => point,
      getObservations: () => Promise.resolve(makeObservations(schedule)),
      getRoute,
      getSchedule: () => schedule,
      now: () => NOW,
      telemetry: vi.fn(),
    });

    const response = await service(trip);
    const assessments = response.sailingAssessments ?? [];
    const coveredBuffers = response.bufferOutcomeBands.flatMap((band) =>
      Array.from(
        { length: band.maximumBufferMinutes - band.minimumBufferMinutes + 1 },
        (_, index) => band.minimumBufferMinutes + index
      )
    );

    expect(getRoute).toHaveBeenCalledOnce();
    expect(coveredBuffers).toEqual(
      Array.from({ length: 61 }, (_, index) => index)
    );
    expect(assessments).toHaveLength(3);
    expect(
      new Set(assessments.map((assessment) => assessment.scheduledDepartureAt))
        .size
    ).toBe(3);
    expect(response.outcome.sailing?.scheduledDepartureAt).toBe(
      schedule.slots[1].time
    );
    const earlier = assessments.find(
      (assessment) => assessment.scheduledDepartureAt === schedule.slots[0].time
    );
    expect(earlier?.capacity?.predictedSpacesAtArrival).toBe(0);
    expect(earlier?.chance.probabilities[0]).toBeGreaterThan(0);
    expect(earlier?.chance.probabilities[0]).toBeLessThan(1);
  });
  // center duplicate-time neighbors on the selected stable sailing identity
  it.each([
    { eligibilityReason: "cancelled", structuralKind: "cancelled" },
    { eligibilityReason: "mode-ineligible", structuralKind: "mode-ineligible" },
  ] as const)(
    "selects the second duplicate after a $structuralKind candidate",
    async ({ eligibilityReason, structuralKind }) => {
      const schedule = makeSchedule();
      const duplicateTime = schedule.slots[0].time;
      schedule.slots[0] = {
        ...schedule.slots[0],
        allowsVehicles: structuralKind !== "mode-ineligible",
        crossing:
          structuralKind === "cancelled"
            ? ({ isCancelled: true } as Slot["crossing"])
            : undefined,
        vessel: {
          ...schedule.slots[0].vessel,
          id: "cancelled-or-ineligible",
          name: "Skipped vessel",
        },
      };
      schedule.slots[1] = {
        ...schedule.slots[1],
        time: duplicateTime,
        vessel: {
          ...schedule.slots[1].vessel,
          id: "chosen",
          name: "Chosen vessel",
        },
        wuid: "chosen-duplicate",
      };
      schedule.slots.push({
        ...schedule.slots[1],
        time: NOW + 80 * 60,
        vessel: {
          ...schedule.slots[1].vessel,
          id: "later",
          name: "Later vessel",
        },
        wuid: "later-neighbor",
      });
      const getRoute = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          durationSeconds: 20 * 60,
          partialMatch: false,
          routeRequestedAt: NOW,
          staticDurationSeconds: 18 * 60,
          trafficAware: true,
          warnings: [],
        },
      });
      const service = createSailingRecommendationService({
        enabled: () => true,
        getAccessPoint: () => point,
        getObservations: () => Promise.resolve(makeObservations(schedule)),
        getRoute,
        getSchedule: () => schedule,
        now: () => NOW,
        telemetry: vi.fn(),
      });

      const response = await service(trip);
      const assessments = response.sailingAssessments ?? [];
      const expectedId = `${schedule.key}:${duplicateTime}:chosen:1`;
      const skipped = assessments.find(
        (assessment) => assessment.vesselName === "Skipped vessel"
      );

      expect(getRoute).toHaveBeenCalledOnce();
      expect(response.outcome.sailing).toMatchObject({
        sailingId: expectedId,
        vesselName: "Chosen vessel",
      });
      expect(assessments).toHaveLength(3);
      expect(assessments.map((assessment) => assessment.vesselName)).toEqual([
        "Skipped vessel",
        "Chosen vessel",
        "Later vessel",
      ]);
      expect(
        assessments.find((assessment) => assessment.sailingId === expectedId)
      ).toMatchObject({ vesselName: "Chosen vessel" });
      expect(skipped).toMatchObject({
        capacity: null,
        eligibilityReason,
      });
      expect(
        skipped?.chance.probabilities.every((chance) => chance === 0)
      ).toBe(true);
      expect(skipped?.chance.timingProbabilities[0]).toBeGreaterThan(0);
    }
  );
  // ignore a cancelled neighbor's capacity anchor while retaining its timing curve
  it("does not expire on structurally irrelevant neighbor capacity", async () => {
    const schedule = makeSchedule();
    schedule.slots[0].crossing = {
      isCancelled: true,
    } as Slot["crossing"];
    const observations = makeObservations(schedule);
    observations[0].receivedAt = NOW - 170;
    const getRoute = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        durationSeconds: 20 * 60,
        partialMatch: false,
        routeRequestedAt: NOW,
        staticDurationSeconds: 18 * 60,
        trafficAware: true,
        warnings: [],
      },
    });
    const service = createSailingRecommendationService({
      enabled: () => true,
      getAccessPoint: () => point,
      getObservations: () => Promise.resolve(observations),
      getRoute,
      getSchedule: () => schedule,
      now: () => NOW,
      telemetry: vi.fn(),
    });

    const response = await service(trip);
    const cancelled = response.sailingAssessments?.find(
      (assessment) => assessment.eligibilityReason === "cancelled"
    );

    expect(getRoute).toHaveBeenCalledOnce();
    expect(cancelled?.capacity).toBeNull();
    expect(cancelled?.chance.timingProbabilities[0]).toBeGreaterThan(0);
    expect(response.validUntil).toBe(NOW + 120);
  });
  // expire the response when a displayed neighbor's inventory anchor expires
  it("includes neighboring capacity anchors in response expiry", async () => {
    const schedule = makeSchedule();
    const observations = makeObservations(schedule);
    observations[1].receivedAt = NOW - 100;
    const service = createSailingRecommendationService({
      enabled: () => true,
      getAccessPoint: () => point,
      getObservations: () => Promise.resolve(observations),
      getRoute: () =>
        Promise.resolve({
          ok: true as const,
          value: {
            durationSeconds: 20 * 60,
            partialMatch: false,
            routeRequestedAt: NOW,
            staticDurationSeconds: 18 * 60,
            trafficAware: true,
            warnings: [],
          },
        }),
      getSchedule: () => schedule,
      now: () => NOW,
      telemetry: vi.fn(),
    });

    const response = await service(trip);

    expect(response.sailingAssessments).toHaveLength(2);
    expect(response.validUntil).toBe(NOW + 80);
  });
  // classify only traffic-aware driving against a usable static baseline
  it.each([
    {
      durationSeconds: 650,
      expectedDelay: 50,
      expectedLevel: "light",
      staticDurationSeconds: 600,
      trafficAware: true,
    },
    {
      durationSeconds: 800,
      expectedDelay: 200,
      expectedLevel: "moderate",
      staticDurationSeconds: 600,
      trafficAware: true,
    },
    {
      durationSeconds: 1_000,
      expectedDelay: 400,
      expectedLevel: "heavy",
      staticDurationSeconds: 600,
      trafficAware: true,
    },
    {
      durationSeconds: 800,
      expectedDelay: null,
      expectedLevel: null,
      staticDurationSeconds: null,
      trafficAware: true,
    },
    {
      durationSeconds: 800,
      expectedDelay: null,
      expectedLevel: null,
      staticDurationSeconds: 600,
      trafficAware: false,
    },
  ] as const)(
    "returns $expectedLevel traffic for the supplied baseline",
    async ({
      durationSeconds,
      expectedDelay,
      expectedLevel,
      staticDurationSeconds,
      trafficAware,
    }) => {
      const schedule = makeSchedule();
      const getRoute = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          durationSeconds,
          partialMatch: false,
          routeRequestedAt: NOW,
          staticDurationSeconds,
          trafficAware,
          warnings: [],
        },
      });
      const service = createSailingRecommendationService({
        enabled: () => true,
        getAccessPoint: () => point,
        getObservations: () => Promise.resolve(makeObservations(schedule)),
        getRoute,
        getSchedule: () => schedule,
        now: () => NOW,
        telemetry: vi.fn(),
      });

      const response = await service(trip);

      expect(getRoute).toHaveBeenCalledOnce();
      expect(response.staticDurationSeconds).toBe(staticDurationSeconds);
      expect(response.trafficDelaySeconds).toBe(expectedDelay);
      expect(response.trafficLevel).toBe(expectedLevel);
    }
  );
  // prefer a known-open sailing while preserving unknown capacity as a timing fallback
  it("continues past unknown drive capacity to a stronger recommendation", () => {
    const schedule = makeSchedule();
    const observations = makeObservations(schedule).slice(1);
    const bands = buildRecommendationBands({
      arrivalAt: NOW + 1200,
      asOf: NOW,
      mode: "drive",
      observations,
      schedule,
    });
    expect(bands[0].outcome.result).toBe("recommended");
    expect(bands[0].outcome.sailing?.scheduledDepartureAt).toBe(
      schedule.slots[1].time
    );
    expect(bands[0].outcome.skipped[0].reason).toBe("capacity-unavailable");
    const unknown = buildRecommendationBands({
      arrivalAt: NOW + 1200,
      asOf: NOW,
      mode: "drive",
      observations: [],
      schedule,
    });
    expect(unknown[0].outcome.result).toBe("timing-only");
    expect(unknown[0].outcome.sailing?.scheduledDepartureAt).toBe(
      schedule.slots[0].time
    );
  });
  // place the observation cutoff after the frozen post-provider schedule snapshot
  it("captures recommendation time after a raced schedule update and emits only aggregate diagnostics", async () => {
    const schedule = makeSchedule();
    let clock = NOW;
    let reads = 0;
    const telemetry = vi.fn();
    const getObservations = vi.fn(async () => makeObservations(schedule));
    const service = createSailingRecommendationService({
      enabled: () => true,
      getAccessPoint: () => point,
      getRoute: async () => ({
        ok: true,
        value: {
          durationSeconds: 1200,
          partialMatch: false,
          routeRequestedAt: NOW,
          trafficAware: true,
          warnings: [],
        },
      }),
      getSchedule: () => {
        reads += 1;
        if (reads === 2) {
          clock += 1;
          schedule.slots[0].estimate = {
            driveUpCapacity: 9,
            reservableCapacity: null,
          };
        }
        return schedule;
      },
      getObservations,
      now: () => clock,
      telemetry,
    });
    const response = await service(trip);
    expect(response.recommendationAsOf).toBe(NOW + 1);
    expect(getObservations.mock.calls[0][0].asOf).toBe(NOW + 1);
    expect(telemetry).toHaveBeenCalledOnce();
    expect(telemetry.mock.calls[0][0]).toMatchObject({
      event: "sailing_recommendation",
      providerOutcome: "success",
      modelVersion: "fill-linear-v1",
    });
    expect(JSON.stringify(telemetry.mock.calls)).not.toMatch(
      /Synthetic test origin|latitude|longitude|origin|providerPayload/
    );
  });
  // distinguish internal data failures without leaking exception metadata
  it("reports the failing internal stage using sanitized telemetry", async () => {
    const telemetry = vi.fn();
    const service = createSailingRecommendationService({
      enabled: () => true,
      getAccessPoint: () => point,
      getSchedule: () => makeSchedule(),
      getObservations: async () => {
        throw new Error("sensitive origin and secret-key");
      },
      getRoute: async () => ({
        ok: true,
        value: {
          durationSeconds: 1200,
          partialMatch: false,
          routeRequestedAt: NOW,
          trafficAware: true,
          warnings: [],
        },
      }),
      now: () => NOW,
      telemetry,
    });
    expect((await service(trip)).outcome.reason).toBe("schedule-unavailable");
    expect(telemetry.mock.calls[0][0].failureStage).toBe("observations");
    expect(JSON.stringify(telemetry.mock.calls)).not.toMatch(
      /sensitive origin|secret-key|Synthetic test origin/
    );
  });
  // maintain the default-off feature boundary
  it("does no provider or schedule work when disabled", async () => {
    const getRoute = vi.fn();
    const getSchedule = vi.fn();
    const service = createSailingRecommendationService({
      enabled: () => false,
      getRoute,
      getSchedule,
      now: () => NOW,
    });
    expect((await service(trip)).outcome.reason).toBe(
      "configuration-unavailable"
    );
    expect(getRoute).not.toHaveBeenCalled();
    expect(getSchedule).not.toHaveBeenCalled();
  });
  // reject paid burst exhaustion before any feature/provider work
  it("normalizes the sixteenth paid request without changing its selected mode", async () => {
    const invoked = vi.fn();
    const app = express();
    app.use(express.json());
    app.use(createApiRateLimitMiddleware());
    app.post("/api/sailing-recommendations", (_request, response) => {
      invoked();
      response.send({ ok: true });
    });
    for (let index = 0; index < 15; index += 1) {
      await request(app)
        .post("/api/sailing-recommendations")
        .send({ ...trip, mode: "walk" })
        .expect(200);
    }
    const response = await request(app)
      .post("/api/sailing-recommendations")
      .send({ ...trip, mode: "walk" })
      .expect(429);
    expect(response.body.mode).toBe("walk");
    expect(response.body.outcome.reason).toBe("provider-quota-unavailable");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(invoked).toHaveBeenCalledTimes(15);
  });
  // retain one daily cap across both protocol routes
  it("normalizes shared daily exhaustion at two hundred requests per ip", async () => {
    const app = express();
    app.use(express.json());
    const telemetry = vi.fn();
    app.use(
      "/api/sailing-recommendations",
      createSailingRecommendationRouter({
        enabled: () => false,
        now: () => NOW,
        telemetry,
      })
    );
    // exercise both versions in bounded batches without a slow socket loop
    for (let batch = 0; batch < 10; batch += 1) {
      await Promise.all(
        Array.from({ length: 20 }, (_, index) => {
          // keep the same ip and daily budget across both protocol routes
          return request(app)
            .post(
              `/api/sailing-recommendations${
                (batch * 20 + index) % 2 === 0 ? "" : "/v2"
              }`
            )
            .send({ ...trip, mode: "transit" })
            .expect(200);
        })
      );
    }
    const response = await request(app)
      .post("/api/sailing-recommendations")
      .send({ ...trip, mode: "transit" })
      .expect(429);
    expect(response.body.mode).toBe("transit");
    expect(response.body.outcome.reason).toBe("provider-quota-unavailable");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(telemetry).toHaveBeenCalledTimes(200);
  }, 15000);
  // share the process admission gate across both protocol paths
  it("admits both protocol routes through one process budget", async () => {
    const schedule = makeSchedule();
    const admitCall = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    const getRoute = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        durationSeconds: 1200,
        partialMatch: false,
        routeRequestedAt: NOW,
        trafficAware: true,
        warnings: [],
      },
    });
    const app = express();
    app.use(express.json());
    app.use(
      "/api/sailing-recommendations",
      createSailingRecommendationRouter({
        admitCall,
        enabled: () => true,
        getAccessPoint: () => point,
        getObservations: () => Promise.resolve(makeObservations(schedule)),
        getRoute,
        getSchedule: () => schedule,
        now: () => NOW,
        rateLimiter: (_request, _response, next) => next(),
        telemetry: vi.fn(),
      })
    );

    await request(app)
      .post("/api/sailing-recommendations")
      .send(trip)
      .expect(200);
    const limited = await request(app)
      .post("/api/sailing-recommendations/v2")
      .send(trip)
      .expect(200);

    expect(admitCall).toHaveBeenCalledTimes(2);
    expect(getRoute).toHaveBeenCalledOnce();
    expect(limited.body.outcome.reason).toBe("provider-quota-unavailable");
  });
  // use confirmed departure evidence instead of permissive hasPassed flags
  it("skips an observed early departure and honors projected delay for the next sailing", () => {
    const schedule = makeSchedule();
    schedule.slots[0].time = NOW + 60;
    schedule.slots[0].vessel = {
      ...schedule.slots[0].vessel,
      scheduledDepartureTime: NOW + 60,
      departedTime: NOW - 60,
    };
    schedule.slots[1].vessel = {
      ...schedule.slots[1].vessel,
      id: "2",
      departureDelta: 1200,
    };
    const bands = buildRecommendationBands({
      arrivalAt: NOW + 85 * 60,
      asOf: NOW,
      mode: "walk",
      observations: [],
      schedule,
    });
    expect(bands[0].outcome.skipped[0].reason).toBe("departed");
    expect(bands[0].outcome.sailing?.projectedDepartureAt).toBe(
      schedule.slots[1].time + 1200
    );
  });
  // preserve the api policy's origin-sensitive paid class for both protocols
  it.each(["", "/v2"])(
    "blocks cross-site writes for the %s protocol route",
    async (suffix) => {
      vi.stubEnv("BASE_URL", "https://ferry.fyi");
      const app = express();
      app.use(express.json());
      app.use(createApiCorsMiddleware());
      app.use(denyUntrustedPaidProviderOrigin);
      app.use(
        "/api/sailing-recommendations",
        createSailingRecommendationRouter({
          enabled: () => false,
          rateLimiter: (_req, _res, next) => next(),
          now: () => NOW,
        })
      );
      expect(
        classifyApiRequest({
          method: "POST",
          pathname: `/api/sailing-recommendations${suffix}`,
        })
      ).toBe("paid-provider");
      await request(app)
        .post(`/api/sailing-recommendations${suffix}`)
        .set("Origin", "https://evil.test")
        .send(trip)
        .expect(403);
      const response = await request(app)
        .post(`/api/sailing-recommendations${suffix}`)
        .set("Origin", "https://ferry.fyi")
        .send(trip)
        .expect(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["access-control-allow-origin"]).toBe(
        "https://ferry.fyi"
      );
      expect(response.body.outcome.reason).toBe("configuration-unavailable");
    }
  );
});
