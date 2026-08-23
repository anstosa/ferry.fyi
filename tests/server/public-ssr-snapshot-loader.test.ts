import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import { createServerApp } from "../../client/entry-server";
import { readPublicSsrSeedResult } from "../../client/lib/ssrSeed";
import {
  renderPublicSsrDocument,
  serializePublicSsrSnapshot,
} from "../../server/ssr/document";
import {
  createPublicSsrSnapshotLoader,
  createPublicSsrTerminalResolver,
  type PublicSsrSnapshotServices,
  PublicSsrTransientFailure,
  toPublicSsrVessel,
} from "../../server/ssr/publicSnapshot";
import { PUBLIC_SSR_SNAPSHOT_SCRIPT_ID } from "../../shared/contracts/ssrDocument";
import { assertPublicSsrSnapshot } from "../../shared/lib/ssrValidation";

const observedAt = "2026-07-28T12:00:00.000Z";
const sourceUpdatedAt = "2026-07-28T11:59:00.000Z";
const terminal = (id: string, name: string, mates: string[]) =>
  ({
    abbreviation: name.slice(0, 3).toUpperCase(),
    bulletins: [],
    cameras: [],
    hasElevator: false,
    hasFood: false,
    hasOverheadLoading: false,
    hasRestroom: true,
    hasWaitingRoom: true,
    id,
    info: {},
    location: { latitude: 47.9, longitude: -122.3 },
    mates: mates.map((mateId) => ({
      abbreviation: mateId === "14" ? "MUK" : "CLI",
      id: mateId,
      name: mateId === "14" ? "Mukilteo" : "Clinton",
    })),
    name,
    popularity: 1,
    routes: {},
    waitTimes: [],
  }) as never;

const makeTerminals = () => ({
  "5": terminal("5", "Clinton", ["14"]),
  "14": terminal("14", "Mukilteo", ["5"]),
  "3": terminal("3", "Bainbridge", ["7"]),
  "4": terminal("4", "Bremerton", ["7"]),
  "7": terminal("7", "Seattle", ["3", "4"]),
});
const schedule = (date: string) => ({
  schedule: {
    date,
    key: `5-14-${date}`,
    mateId: "14",
    slots: [],
    sourceUpdatedAt: Math.floor(new Date(sourceUpdatedAt).getTime() / 1000),
    terminalId: "5",
    validRange: null,
  },
  status: "available" as const,
  timestamp: Math.floor(new Date(sourceUpdatedAt).getTime() / 1000),
});
function assignedSchedule(
  date: string,
  vesselIds: string[]
): ReturnType<typeof schedule> {
  const result = schedule(date);
  return {
    ...result,
    schedule: {
      ...result.schedule,
      slots: vesselIds.map(
        (id, index) =>
          ({
            allowsPassengers: true,
            allowsVehicles: true,
            hasPassed: false,
            mateId: "14",
            time: 1_785_000_000 + index,
            vessel: { id },
            wuid: `slot-${index}`,
          }) as never
      ),
    },
  };
}
const catalog = (kind: "catalog" | "no-fare" = "catalog") =>
  kind === "catalog"
    ? {
        catalog: {
          collectionDescription: null,
          fares: [],
          freshness: {
            fetchedAt: Math.floor(new Date(sourceUpdatedAt).getTime() / 1000),
            policyVersion: "test",
            sourceCacheFlushDate: "test",
            validFrom: "2026-01-01",
            validThrough: "2026-12-31",
          },
          kind: "catalog" as const,
          request: {
            arrivingTerminalId: "14",
            departingTerminalId: "5",
            roundTrip: false,
            tripDate: "2026-07-28" as const,
          },
        },
        kind: "catalog" as const,
      }
    : {
        kind: "no-fare" as const,
        noFare: {
          freshness: {
            fetchedAt: Math.floor(new Date(sourceUpdatedAt).getTime() / 1000),
            policyVersion: "test",
            sourceCacheFlushDate: "test",
            validFrom: "2026-01-01",
            validThrough: "2026-12-31",
          },
          kind: "no-fare" as const,
          message: null,
          request: {
            arrivingTerminalId: "14",
            departingTerminalId: "5",
            roundTrip: false,
            tripDate: "2026-07-28" as const,
          },
          sourceUrl: null,
        },
      };

const services = (): PublicSsrSnapshotServices => ({
  getAdCreative: vi.fn().mockImplementation((placementKey: string) =>
    Promise.resolve({
      advertiserName: "Island Coffee",
      body: "Coffee near the dock.",
      campaignId: "5ed338e9-acbb-4cca-9380-1a923bfca5c8",
      headline: "Fuel up before sailing",
      placementKey,
      targetUrl: "https://example.com/menu",
    })
  ),
  getCameraFrames: vi.fn().mockResolvedValue({
    frames: {},
    sourceUpdatedAt: Math.floor(new Date(sourceUpdatedAt).getTime() / 1000),
  }),
  getContent: vi.fn().mockResolvedValue({
    announcements: [{ body: "Open", id: "notice", title: "Service update" }],
    crawlerPolicy: { aiCrawlers: "allow", disallowPaths: [] },
    leaderboardIndexingEnabled: true,
    leaderboardSharingEnabled: true,
    maintenance: { enabled: false, message: "" },
  }),
  getFareCatalog: vi.fn().mockResolvedValue(catalog()),
  getLeaderboard: vi.fn().mockResolvedValue({
    entityId: "5",
    period: "all",
    ranks: [{ label: "Public rider", rank: 1, score: 4 }],
  }),
  getPublicLeaderboardsEnabled: vi.fn().mockResolvedValue(true),
  getSchedule: vi
    .fn()
    .mockImplementation(({ date }) => Promise.resolve(schedule(date))),
  getTerminals: vi.fn().mockResolvedValue(makeTerminals()),
  getVessels: vi.fn().mockResolvedValue({
    vessel: {
      abbreviation: "KWS",
      id: "vessel",
      inMaintenance: false,
      inService: true,
      name: "Kitsap",
      speed: 12,
    },
  }),
  getWsfStatus: vi.fn().mockResolvedValue({ coreReady: true, offline: false }),
});

const input = (absoluteUrl: string) => ({
  absoluteUrl,
  contentRevision: "test-revision",
  fixedClock: new Date(observedAt),
  release: { publishedAt: "2026-07-28T00:00:00.000Z", version: "test" },
});
const loaderFor = (publicServices = services()) => ({
  loader: createPublicSsrSnapshotLoader({ services: publicServices }),
  publicServices,
});
const snapshotFor = async (url: string, publicServices = services()) => {
  const result = await createPublicSsrSnapshotLoader({
    services: publicServices,
  })(input(url));
  expect(result.classification).toBe("snapshot");
  if (result.classification !== "snapshot") {
    throw new Error("Expected snapshot");
  }
  expect(() =>
    assertPublicSsrSnapshot(result.snapshot, createPublicSsrTerminalResolver())
  ).not.toThrow();
  return result.snapshot;
};
const noCalls = (publicServices: PublicSsrSnapshotServices) =>
  expect(
    Object.values(publicServices).every((service) => !service.mock.calls.length)
  ).toBe(true);

describe("public SSR snapshot loader", () => {
  it("builds a Ferry FYI snapshot for the documented local origin", async () => {
    const snapshot = await snapshotFor("http://localhost:4040/");

    expect(snapshot).toMatchObject({
      canonicalHost: "ferry.fyi",
      canonicalPath: "/",
      hostProfile: "ferry.fyi",
      routeId: "home",
    });
  });

  it("attributes safe per-source load durations", async () => {
    let monotonicNow = 0;
    const result = await createPublicSsrSnapshotLoader({
      monotonicClock: () => {
        monotonicNow += 1;
        return monotonicNow;
      },
      services: services(),
    })(input("https://ferry.fyi/"));

    expect(result.classification).toBe("snapshot");
    if (result.classification !== "snapshot") {
      throw new Error("Expected snapshot");
    }
    expect(result.sourceDurationsMs).toMatchObject({
      ad: expect.any(Number),
      features: expect.any(Number),
      notices: expect.any(Number),
      terminals: expect.any(Number),
    });
    expect(
      Object.values(result.sourceDurationsMs ?? {}).every(
        (duration) => duration >= 1
      )
    ).toBe(true);
  });

  it("includes the active home creative in the SSR snapshot", async () => {
    const snapshot = await snapshotFor("https://ferry.fyi/");

    expect(snapshot.sources.ad).toMatchObject({
      outcome: "value",
      value: {
        creative: {
          advertiserName: "Island Coffee",
          placementKey: "home",
        },
        placementKey: "home",
      },
    });
  });

  it("round-trips a terminal-and-mate snapshot through the document seed parser", async () => {
    const snapshot = await snapshotFor(
      "https://ferry.fyi/seattle/bainbridge?date=2026-07-28"
    );
    const { document } = new JSDOM(
      `<script id="${PUBLIC_SSR_SNAPSHOT_SCRIPT_ID}" type="application/json">${serializePublicSsrSnapshot(snapshot)}</script>`
    ).window;

    expect(readPublicSsrSeedResult(document)).toEqual({
      category: undefined,
      snapshot,
    });
  });

  it("projects full vessel records to the snapshot allowlist", () => {
    expect(
      toPublicSsrVessel({
        abbreviation: "KWS",
        id: "vessel-1",
        inMaintenance: false,
        inService: true,
        name: "Kitsap",
        speed: 12,
        accessToken: "must-not-cross",
      })
    ).toEqual({
      abbreviation: "KWS",
      id: "vessel-1",
      inMaintenance: false,
      inService: true,
      name: "Kitsap",
      speed: 12,
    });
  });

  it.each([
    ["/about", "about"],
    ["/data-sources", "data-sources"],
    ["/install", "install"],
    ["/privacy", "privacy"],
    ["/forecasting", "forecasting"],
    ["/support", "support"],
    ["/supporter", "supporter"],
    ["/terms", "terms"],
  ])(
    "builds editorial-only %s snapshots without operational calls",
    async (path, routeId) => {
      const { loader, publicServices } = loaderFor();
      await expect(
        loader(input(`https://ferry.fyi${path}`))
      ).resolves.toMatchObject({
        classification: "snapshot",
        snapshot: { routeId, sources: { editorial: { outcome: "value" } } },
      });
      noCalls(publicServices);
    }
  );

  it("builds the public ticket shell without reading private services", async () => {
    const { loader, publicServices } = loaderFor();
    await expect(
      loader(input("https://ferry.fyi/tickets"))
    ).resolves.toMatchObject({
      classification: "snapshot",
      snapshot: {
        routeId: "tickets",
        sources: {
          editorial: { outcome: "value" },
          ticketGuidance: { outcome: "value" },
        },
      },
    });
    noCalls(publicServices);
  });

  it.each([
    ["/account", "account"],
    ["/login", "login"],
    ["/logout", "logout"],
    ["/admin", "admin"],
    ["/leaderboards/settings", "leaderboards-settings"],
    ["/leaderboards/nope", "leaderboards-unmatched"],
  ])(
    "classifies private %s without calling services",
    async (path, routeId) => {
      const { loader, publicServices } = loaderFor();
      await expect(
        loader(input(`https://ferry.fyi${path}`))
      ).resolves.toMatchObject({
        classification: "private",
        match: { route: { id: routeId } },
        snapshot: undefined,
      });
      noCalls(publicServices);
    }
  );

  it("classifies callback URLs without inspecting query canaries or calling services", async () => {
    const { loader, publicServices } = loaderFor();
    await expect(
      loader(input("https://ferry.fyi/callback?code=secret&state=canary"))
    ).resolves.toMatchObject({
      classification: "private",
      match: { route: { id: "callback" } },
      snapshot: undefined,
    });
    noCalls(publicServices);
  });

  it("classifies the forecasting redirect without loading a snapshot", async () => {
    const { loader, publicServices } = loaderFor();
    await expect(
      loader(input("https://ferry.fyi/forecasting-explained"))
    ).resolves.toMatchObject({
      classification: "redirect",
      match: { route: { id: "forecasting-explained" } },
      redirectTo: "/forecasting",
      snapshot: undefined,
    });
    noCalls(publicServices);
  });

  // verify the legacy support redirect contract
  it("classifies the feedback redirect without loading a snapshot", async () => {
    const { loader, publicServices } = loaderFor();
    await expect(
      loader(input("https://ferry.fyi/feedback"))
    ).resolves.toMatchObject({
      classification: "redirect",
      match: { route: { id: "feedback" } },
      redirectTo: "/support",
      snapshot: undefined,
    });
    noCalls(publicServices);
  });

  it("creates a request-neutral 404 snapshot without calling services", async () => {
    const { loader, publicServices } = loaderFor();
    await expect(
      loader(input("https://ferry.fyi/not-a-public-route"))
    ).resolves.toMatchObject({
      classification: "snapshot",
      match: { canonicalPath: "/404", params: {}, query: { values: {} } },
      snapshot: {
        canonicalPath: "/404",
        normalizedUrl: { path: "/404", query: {} },
        routeId: "unknown-public-path",
        routeParams: {},
        sources: {},
      },
    });
    noCalls(publicServices);
  });

  it("loads home terminal, feature, and notice sources", async () => {
    const publicServices = services();
    const snapshot = await snapshotFor("https://ferry.fyi/", publicServices);
    expect(snapshot.sources).toMatchObject({
      features: { value: { leaderboardsEnabled: true } },
      notices: { value: { announcements: [{ id: "notice" }] } },
      terminals: { outcome: "value", sourceUpdatedAt: null },
    });
    expect(publicServices.getTerminals).toHaveBeenCalledOnce();
    expect(publicServices.getContent).toHaveBeenCalledOnce();
    expect(publicServices.getPublicLeaderboardsEnabled).toHaveBeenCalledOnce();
  });

  it("projects compact terminal summaries into the home snapshot", async () => {
    const publicServices = services();
    publicServices.getTerminals.mockResolvedValue({
      "5": {
        ...terminal("5", "Clinton", ["14"]),
        info: { construction: null },
        routes: {
          route: {
            abbreviation: "cli-muk",
            averageVehicleCapacity: undefined,
            crossingTime: 20,
            date: "",
            description: "Clinton / Mukilteo",
            galleyHours: undefined,
            id: "route",
            normalVehicleCapacity: undefined,
            normalVehicleMaxCapacity: undefined,
            terminalIds: ["5", "14"],
          },
        },
        waitTimes: [{ description: "Arrive early", time: 1, title: null }],
      } as never,
    });

    const snapshot = await snapshotFor("https://ferry.fyi/", publicServices);
    expect(snapshot.sources.terminals).toMatchObject({
      outcome: "value",
      value: [
        {
          abbreviation: "CLI",
          id: "5",
          location: {
            latitude: expect.any(Number),
            longitude: expect.any(Number),
          },
          name: "Clinton",
        },
      ],
    });
    const terminalSource = snapshot.sources.terminals;
    expect(terminalSource.outcome).toBe("value");
    if (terminalSource.outcome !== "value") {
      throw new Error("Expected a terminal summary value");
    }
    const [summary] = terminalSource.value;
    expect(summary).not.toHaveProperty("bulletins");
    expect(summary).not.toHaveProperty("cameras");
    expect(summary).not.toHaveProperty("info");
    expect(summary).not.toHaveProperty("routes");
    expect(summary).not.toHaveProperty("waitTimes");
  });

  it("emits canonical empty outcomes for an empty home directory and notices", async () => {
    const publicServices = services();
    publicServices.getTerminals.mockResolvedValue({});
    publicServices.getContent.mockResolvedValue({
      announcements: [],
      crawlerPolicy: { aiCrawlers: "allow", disallowPaths: [] },
      leaderboardIndexingEnabled: true,
      leaderboardSharingEnabled: true,
      maintenance: { enabled: false, message: "" },
    });
    const snapshot = await snapshotFor("https://ferry.fyi/", publicServices);
    expect(snapshot.sources.terminals).toMatchObject({
      outcome: "empty",
      sourceUpdatedAt: null,
      value: [],
    });
    expect(snapshot.sources.notices).toMatchObject({
      outcome: "empty",
      sourceUpdatedAt: null,
      value: {
        announcements: [],
        maintenance: { enabled: false, message: "" },
      },
    });
  });

  it("loads the howmanyboats Today profile with current and next schedules", async () => {
    const publicServices = services();
    const snapshot = await snapshotFor(
      "https://howmanyboats.today/",
      publicServices
    );
    expect(snapshot).toMatchObject({ canonicalPath: "/", routeId: "today" });
    expect(publicServices.getSchedule).toHaveBeenNthCalledWith(1, {
      arrivingId: "14",
      date: "2026-07-28",
      departingId: "5",
    });
    expect(publicServices.getSchedule).toHaveBeenNthCalledWith(2, {
      arrivingId: "14",
      date: "2026-07-29",
      departingId: "5",
    });
    expect(snapshot.sources.schedule.sourceUpdatedAt).toBe(sourceUpdatedAt);
    expect(snapshot.sources.nextSchedule.sourceUpdatedAt).toBe(sourceUpdatedAt);
  });

  it("projects live schedule models to the public SSR allowlist", async () => {
    const publicServices = services();
    publicServices.getSchedule.mockImplementation(
      ({ date }) =>
        Promise.resolve({
          ...schedule(date),
          schedule: {
            ...schedule(date).schedule,
            slots: [
              {
                allowsPassengers: true,
                allowsVehicles: true,
                crossing: {
                  arrivalId: 14,
                  createdAt: "private persistence metadata",
                  departureDelta: 0,
                  departureId: 5,
                  departureTime: 1_785_000_000,
                  driveUpCapacity: 57,
                  hasDriveUp: true,
                  hasReservations: false,
                  id: 123,
                  isCancelled: false,
                  reservableCapacity: null,
                  totalCapacity: 141,
                  updatedAt: "private persistence metadata",
                },
                estimate: {
                  driveUpCapacity: 57,
                  error: "must-not-cross",
                  factors: [
                    {
                      detail: "Historical sailings",
                      impact: "neutral",
                      label: "Historical pattern",
                      updatedAt: "must-not-cross",
                    },
                  ],
                  reservableCapacity: 0,
                },
                hasPassed: false,
                mateId: "14",
                tide: {
                  createdAt: "must-not-cross",
                  stationId: "9447659",
                  waterLevelM: 2.7,
                },
                time: 1_785_000_000,
                vessel: {
                  abbreviation: "Suquamish",
                  accessToken: "must-not-cross",
                  id: "75",
                  name: "Suquamish",
                  speed: 0,
                  tallVehicleCapacity: 0,
                  vehicleCapacity: 0,
                  vesselWatchUrl: "",
                },
                weather: {
                  cloudCoverPercent: 3,
                  highTemperatureC: 24,
                  precipitationMm: 0,
                  temperatureC: 11.3,
                  updatedAt: "must-not-cross",
                  windGustKmh: 6.8,
                  windSpeedKmh: 4.1,
                },
                wuid: "slot-1",
              },
            ],
          },
        }) as never
    );

    const snapshot = await snapshotFor(
      "https://howmanyboats.today/",
      publicServices
    );
    await expect(
      snapshotFor("https://ferry.fyi/clinton", publicServices)
    ).resolves.toMatchObject({ routeId: "terminal-schedule" });

    expect(snapshot.sources.schedule).toMatchObject({
      outcome: "value",
      value: {
        schedule: {
          slots: [
            {
              crossing: {
                arrivalId: "14",
                departureId: "5",
                reservableCapacity: 0,
              },
              vessel: {
                abbreviation: "Suquamish",
                id: "75",
                name: "Suquamish",
              },
            },
          ],
        },
      },
    });
    expect(snapshot.sources.schedule).not.toHaveProperty(
      "value.schedule.slots.0.crossing.createdAt"
    );
    expect(snapshot.sources.schedule).not.toHaveProperty(
      "value.schedule.slots.0.vessel.accessToken"
    );
    expect(snapshot.sources.schedule).not.toHaveProperty(
      "value.schedule.slots.0.estimate.error"
    );
    expect(snapshot.sources.schedule).not.toHaveProperty(
      "value.schedule.slots.0.estimate.factors.0.updatedAt"
    );
    expect(snapshot.sources.schedule).not.toHaveProperty(
      "value.schedule.slots.0.tide.createdAt"
    );
    expect(snapshot.sources.schedule).not.toHaveProperty(
      "value.schedule.slots.0.weather.updatedAt"
    );
  });

  it("omits an incomplete next-day forecast instead of failing the schedule document", async () => {
    const publicServices = services();
    publicServices.getSchedule
      .mockResolvedValueOnce(schedule("2026-07-28"))
      .mockResolvedValueOnce({
        ...schedule("2026-07-29"),
        schedule: {
          ...schedule("2026-07-29").schedule,
          slots: [
            {
              allowsPassengers: true,
              allowsVehicles: true,
              estimate: {
                driveUpCapacity: null,
                reservableCapacity: null,
              },
              hasPassed: false,
              mateId: "14",
              time: 1_785_000_000,
              vessel: {
                abbreviation: "SUQ",
                id: "75",
                name: "Suquamish",
                speed: 0,
                tallVehicleCapacity: 0,
                vehicleCapacity: 0,
                vesselWatchUrl: "",
              },
              wuid: "slot-1",
            },
          ],
        },
      } as never);

    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton",
      publicServices
    );

    expect(snapshot.sources.nextSchedule).not.toHaveProperty(
      "value.schedule.slots.0.estimate"
    );
  });

  it("loads canonical schedule details with a valid date query", async () => {
    const publicServices = services();
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton?date=2026-08-01",
      publicServices
    );
    expect(snapshot.normalizedUrl.query).toEqual({ date: "2026-08-01" });
    expect(publicServices.getSchedule).toHaveBeenNthCalledWith(1, {
      arrivingId: "14",
      date: "2026-08-01",
      departingId: "5",
    });
    expect(publicServices.getSchedule).toHaveBeenNthCalledWith(2, {
      arrivingId: "14",
      date: "2026-08-02",
      departingId: "5",
    });
  });

  it("ignores repeated invalid and tracking schedule queries", async () => {
    const publicServices = services();
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton?date=2026-08-01&date=bad&utm_source=canary",
      publicServices
    );
    expect(snapshot.normalizedUrl.query).toEqual({});
    expect(publicServices.getSchedule).toHaveBeenNthCalledWith(1, {
      arrivingId: "14",
      date: "2026-07-28",
      departingId: "5",
    });
  });

  it("loads terminal details without schedule or status calls", async () => {
    const publicServices = services();
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton/terminal",
      publicServices
    );
    expect(snapshot.routeId).toBe("terminal-details");
    expect(snapshot.sources).toHaveProperty("route");
    expect(publicServices.getSchedule).not.toHaveBeenCalled();
    expect(publicServices.getWsfStatus).not.toHaveBeenCalled();
  });

  it("loads camera frames for the selected terminal cameras", async () => {
    const publicServices = services();
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton/cameras",
      publicServices
    );
    expect(snapshot.sources.cameraFrames).toMatchObject({
      outcome: "value",
      value: { frames: {} },
    });
    expect(publicServices.getCameraFrames).toHaveBeenCalledWith([]);
  });

  it("emits an empty outcome when camera frames have no authoritative frame data", async () => {
    const publicServices = services();
    publicServices.getCameraFrames.mockResolvedValue({
      frames: {},
      sourceUpdatedAt: null,
    });
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton/cameras",
      publicServices
    );
    expect(snapshot.sources.cameraFrames).toMatchObject({
      outcome: "empty",
      sourceUpdatedAt: null,
      value: { frames: {}, sourceUpdatedAt: null },
    });
  });

  it("loads a current fare catalog with its original freshness timestamp", async () => {
    const publicServices = services();
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton/fare?fareMode=vehicle&fareAdults=02",
      publicServices
    );
    expect(snapshot.normalizedUrl.query).toEqual({});
    expect(snapshot.sources.fares).toMatchObject({
      outcome: "value",
      sourceUpdatedAt,
      value: { state: "current" },
    });
    expect(publicServices.getFareCatalog).toHaveBeenCalledWith({
      arrivingTerminalId: "14",
      departingTerminalId: "5",
      roundTrip: false,
      tripDate: "2026-07-28",
    });
  });

  it("loads an authoritative no-fare outcome", async () => {
    const publicServices = services();
    publicServices.getFareCatalog.mockResolvedValue(catalog("no-fare"));
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton/fare",
      publicServices
    );
    expect(snapshot.sources.fares).toMatchObject({
      outcome: "value",
      sourceUpdatedAt,
      value: { state: "no-fare" },
    });
  });

  it("preserves a policy-blocked fare source as authoritative absence", async () => {
    const publicServices = services();
    publicServices.getFareCatalog.mockResolvedValue({
      kind: "unavailable",
      reason: "policy",
    });
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton/fare",
      publicServices
    );
    expect(snapshot.sources.fares).toMatchObject({
      outcome: "authoritatively-unavailable",
      reason: "not-published",
      sourceUpdatedAt: null,
    });
  });

  it.each([
    "upstream-unavailable",
    "generation-race",
    "invalid-source",
    "invalid-request",
  ] as const)(
    "treats %s fare outcomes as retryable snapshot failures",
    async (reason) => {
      const publicServices = services();
      publicServices.getFareCatalog.mockResolvedValue({
        kind: "unavailable",
        reason,
      });
      const load = createPublicSsrSnapshotLoader({
        services: publicServices,
      });

      await expect(
        load({
          absoluteUrl: "https://ferry.fyi/clinton/fare",
          contentRevision: "test",
          fixedClock: new Date(observedAt),
          release: { publishedAt: null, version: "test" },
        })
      ).rejects.toMatchObject({
        code: "public-ssr-transient-failure",
        source: "fares",
      });
    }
  );

  it("serializes and universally renders only vessels assigned to the selected route", async () => {
    const publicServices = services();
    publicServices.getSchedule.mockImplementation(({ date }) =>
      Promise.resolve(assignedSchedule(date, ["vessel"]))
    );
    publicServices.getVessels.mockResolvedValue({
      vessel: {
        abbreviation: "KWS",
        id: "vessel",
        inMaintenance: false,
        inService: true,
        name: "Kitsap",
        speed: 12,
        token: "canary",
      },
      "off-route": {
        abbreviation: "OFF",
        id: "off-route",
        inMaintenance: false,
        inService: true,
        name: "Off Route Fleet Vessel",
        speed: 11,
        token: "off-route-canary",
      },
    });
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton/map",
      publicServices
    );
    expect(snapshot.sources.vessels.value).toEqual([
      {
        abbreviation: "KWS",
        id: "vessel",
        inMaintenance: false,
        inService: true,
        name: "Kitsap",
        speed: 12,
      },
    ]);
    const rendered = await renderPublicSsrDocument({
      context: {
        clock: () => Date.parse(observedAt),
        platform: "web",
        requestUrl: "https://ferry.fyi/clinton/map",
        runtime: "server",
        seoBaseUrl: "https://ferry.fyi",
        seoHost: "ferry.fyi",
        seoPathname: "/clinton/map",
      },
      entry: { createServerApp },
      snapshot,
      template:
        '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    });
    expect(rendered.html).toContain("Kitsap");
    expect(rendered.html).not.toContain("Off Route Fleet Vessel");
    expect(rendered.html).not.toContain("off-route");
    expect(rendered.html).not.toContain("off-route-canary");
    expect(publicServices.getSchedule).toHaveBeenCalledWith({
      arrivingId: "14",
      date: "2026-07-28",
      departingId: "5",
    });
    expect(publicServices.getVessels).toHaveBeenCalledOnce();
  });

  it("emits an empty outcome when the selected route has no assigned public vessels", async () => {
    const publicServices = services();
    publicServices.getSchedule.mockImplementation(({ date }) =>
      Promise.resolve(assignedSchedule(date, []))
    );
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton/map",
      publicServices
    );
    expect(snapshot.sources.vessels).toEqual({
      observedAt,
      outcome: "empty",
      sourceUpdatedAt: null,
      value: [],
    });
    expect(publicServices.getVessels).not.toHaveBeenCalled();
  });

  it("publishes a warming map schedule as a transient vessels source without widening to the whole fleet", async () => {
    const publicServices = services();
    publicServices.getSchedule.mockResolvedValue({ status: "warming" });
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton/map",
      publicServices
    );
    expect(snapshot.sources.vessels).toEqual({
      observedAt,
      outcome: "transiently-unavailable",
      reason: "warming",
      sourceUpdatedAt: null,
    });
    expect(publicServices.getVessels).not.toHaveBeenCalled();
  });

  it("publishes a refreshing map schedule as a transient vessels source without widening to the whole fleet", async () => {
    const publicServices = services();
    publicServices.getSchedule.mockResolvedValue({ status: "refreshing" });
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton/map",
      publicServices
    );
    expect(snapshot.sources.vessels).toEqual({
      observedAt,
      outcome: "transiently-unavailable",
      reason: "refreshing",
      sourceUpdatedAt: null,
    });
    expect(publicServices.getVessels).not.toHaveBeenCalled();
  });

  it("publishes a reviewed not-found map schedule without widening to the whole fleet", async () => {
    const publicServices = services();
    publicServices.getSchedule.mockResolvedValue({ status: "not-found" });
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton/map",
      publicServices
    );
    expect(snapshot.sources.vessels).toEqual({
      observedAt,
      outcome: "authoritatively-unavailable",
      reason: "source-unavailable",
      sourceUpdatedAt: null,
    });
    expect(publicServices.getVessels).not.toHaveBeenCalled();
  });

  it("loads bulletins for alerts", async () => {
    const snapshot = await snapshotFor("https://ferry.fyi/clinton/alerts");
    expect(snapshot.sources.bulletins).toMatchObject({
      outcome: "empty",
      value: [],
    });
  });

  it("loads anonymous guidance for subscription", async () => {
    const snapshot = await snapshotFor("https://ferry.fyi/clinton/subscribe");
    expect(snapshot.sources.alertGuidance).toMatchObject({
      outcome: "value",
      value: { title: "Ferry alerts" },
    });
  });

  it.each([
    ["", "mate-schedule"],
    ["/cameras", "mate-cameras"],
    ["/fare", "mate-fares"],
    ["/map", "mate-map"],
    ["/alerts", "mate-alerts"],
    ["/subscribe", "mate-subscribe"],
  ])(
    "loads the mate %s view with its route-specific source matrix",
    async (suffix, routeId) => {
      const snapshot = await snapshotFor(
        `https://ferry.fyi/seattle/bainbridge${suffix}`
      );
      expect(snapshot.routeId).toBe(routeId);
      expect(snapshot.routeParams).toEqual({
        mateSlug: "bainbridge",
        terminalSlug: "seattle",
      });
    }
  );

  it("redirects a mate terminal-details URL to its terminal canonical path", async () => {
    const { loader } = loaderFor();
    await expect(
      loader(input("https://ferry.fyi/seattle/bainbridge/terminal"))
    ).resolves.toMatchObject({
      classification: "redirect",
      redirectTo: "/seattle/terminal",
      snapshot: undefined,
    });
  });

  it("normalizes a terminal alias before loading its elided route", async () => {
    const publicServices = services();
    const snapshot = await snapshotFor("https://ferry.fyi/cli", publicServices);
    expect(snapshot.canonicalPath).toBe("/clinton");
    expect(snapshot.routeParams).toEqual({ terminalSlug: "clinton" });
  });

  it("turns an invalid mate into a request-neutral 404 before loading services", async () => {
    const { loader, publicServices } = loaderFor();
    await expect(
      loader(input("https://ferry.fyi/clinton/not-a-mate"))
    ).resolves.toMatchObject({
      classification: "snapshot",
      snapshot: { canonicalPath: "/404", routeId: "unknown-public-path" },
    });
    noCalls(publicServices);
  });

  it("elides the canonical mate when the terminal has one mate", async () => {
    const publicServices = services();
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton",
      publicServices
    );
    expect(snapshot.routeId).toBe("terminal-schedule");
    expect(snapshot.routeParams).toEqual({ terminalSlug: "clinton" });
  });

  it("redirects an explicit mate when the terminal has one mate", async () => {
    const { loader } = loaderFor();
    await expect(
      loader(input("https://ferry.fyi/clinton/mukilteo"))
    ).resolves.toMatchObject({
      classification: "redirect",
      redirectTo: "/clinton",
      snapshot: undefined,
    });
  });

  it("redirects a mate-elided route when the terminal has multiple mates", async () => {
    const publicServices = services();
    const fixtureTerminals = makeTerminals();
    (fixtureTerminals["5"] as { mates: unknown[] }).mates = [
      { abbreviation: "MUK", id: "14", name: "Mukilteo" },
      { abbreviation: "CLI", id: "5", name: "Clinton" },
    ];
    publicServices.getTerminals.mockResolvedValue(fixtureTerminals);
    const { loader } = loaderFor(publicServices);
    await expect(
      loader(input("https://ferry.fyi/clinton?date=2026-07-28&utm=canary"))
    ).resolves.toMatchObject({
      classification: "redirect",
      redirectTo: "/clinton/mukilteo?date=2026-07-28",
      snapshot: undefined,
    });
    expect(publicServices.getTerminals).toHaveBeenCalledOnce();
    expect(publicServices.getSchedule).not.toHaveBeenCalled();
  });

  it("loads the public leaderboard index with terminal and vessel entities", async () => {
    const snapshot = await snapshotFor("https://ferry.fyi/leaderboards");
    expect(snapshot.sources.leaderboardIndex.value.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "5", kind: "terminal" }),
        expect.objectContaining({ id: "vessel", kind: "vessel" }),
      ])
    );
  });

  it("emits an empty outcome when the public leaderboard index has no entities", async () => {
    const publicServices = services();
    publicServices.getTerminals.mockResolvedValue({});
    publicServices.getVessels.mockResolvedValue({});
    const snapshot = await snapshotFor(
      "https://ferry.fyi/leaderboards",
      publicServices
    );
    expect(snapshot.sources.leaderboardIndex).toMatchObject({
      outcome: "empty",
      sourceUpdatedAt: null,
      value: { defaultPeriod: "all", entities: [] },
    });
  });

  it("keeps an identified leaderboard with no ranks as a value outcome", async () => {
    const publicServices = services();
    publicServices.getLeaderboard.mockResolvedValue({
      entityId: "5",
      period: "all",
      ranks: [],
    });
    const snapshot = await snapshotFor(
      "https://ferry.fyi/leaderboards/terminals/5",
      publicServices
    );
    expect(snapshot.sources.leaderboard).toMatchObject({
      outcome: "value",
      value: { entity: { id: "5", kind: "terminal" }, ranks: [] },
    });
  });

  it.each([
    ["/leaderboards/terminals/5", "terminal", "5"],
    ["/leaderboards/vessels/vessel", "vessel", "vessel"],
  ])("loads a public %s leaderboard", async (path, kind, entityId) => {
    const publicServices = services();
    const snapshot = await snapshotFor(
      `https://ferry.fyi${path}`,
      publicServices
    );
    expect(snapshot.sources.leaderboard).toMatchObject({
      value: { entity: { id: entityId, kind } },
    });
    expect(publicServices.getLeaderboard).toHaveBeenCalledWith({
      entityId,
      kind,
      period: "all",
    });
  });

  it("marks leaderboards noindex when content disables public indexing", async () => {
    const publicServices = services();
    publicServices.getContent.mockResolvedValue({
      ...(await publicServices.getContent()),
      leaderboardIndexingEnabled: false,
    });
    const snapshot = await snapshotFor(
      "https://ferry.fyi/leaderboards",
      publicServices
    );
    expect(snapshot).toMatchObject({
      indexability: "noindex",
      metadata: { robots: "noindex,follow" },
    });
  });

  it.each([
    ["/leaderboards", "leaderboardIndex"],
    ["/leaderboards/terminals/5", "leaderboard"],
    ["/leaderboards/vessels/vessel", "leaderboard"],
  ] as const)(
    "keeps disabled global leaderboard route %s noindex and data-free",
    async (path, sourceKey) => {
      const publicServices = services();
      publicServices.getPublicLeaderboardsEnabled.mockResolvedValue(false);
      const snapshot = await snapshotFor(
        `https://ferry.fyi${path}`,
        publicServices
      );
      expect(snapshot).toMatchObject({
        indexability: "noindex",
        metadata: { robots: "noindex,follow" },
        sources: {
          features: { value: { leaderboardsEnabled: false } },
          notices: { outcome: "empty" },
          [sourceKey]: { outcome: "empty" },
        },
      });
      expect(JSON.stringify(snapshot.sources)).not.toContain("Public rider");
      expect(publicServices.getContent).not.toHaveBeenCalled();
      expect(publicServices.getLeaderboard).not.toHaveBeenCalled();
      expect(publicServices.getTerminals).not.toHaveBeenCalled();
      expect(publicServices.getVessels).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["getCameraFrames", "cameraFrames", "https://ferry.fyi/clinton/cameras"],
    ["getFareCatalog", "fares", "https://ferry.fyi/clinton/fare"],
    ["getVessels", "vessels", "https://ferry.fyi/clinton/map"],
    ["getWsfStatus", "wsf", "https://ferry.fyi/clinton"],
    ["getPublicLeaderboardsEnabled", "features", "https://ferry.fyi/"],
    [
      "getLeaderboard",
      "leaderboard",
      "https://ferry.fyi/leaderboards/terminals/5",
    ],
  ] as const)(
    "maps a thrown %s source to typed transient failure",
    async (method, source, url) => {
      const publicServices = services();
      if (method === "getVessels") {
        publicServices.getSchedule.mockImplementation(({ date }) =>
          Promise.resolve(assignedSchedule(date, ["vessel"]))
        );
      }
      publicServices[method].mockRejectedValue(new Error("source failure"));
      const { loader } = loaderFor(publicServices);
      await expect(loader(input(url))).rejects.toMatchObject<
        Partial<PublicSsrTransientFailure>
      >({
        code: "public-ssr-transient-failure",
        source,
      });
    }
  );

  it("publishes an unavailable current schedule as a transient source", async () => {
    const publicServices = services();
    publicServices.getSchedule.mockResolvedValue({ status: "warming" });
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton",
      publicServices
    );
    expect(snapshot.sources.schedule).toEqual({
      observedAt,
      outcome: "transiently-unavailable",
      reason: "warming",
      sourceUpdatedAt: null,
    });
  });

  it("publishes an unavailable next schedule as a transient source", async () => {
    const publicServices = services();
    publicServices.getSchedule
      .mockResolvedValueOnce(schedule("2026-07-28"))
      .mockResolvedValueOnce({ status: "warming" });
    const snapshot = await snapshotFor(
      "https://ferry.fyi/clinton",
      publicServices
    );
    expect(snapshot.sources.nextSchedule).toEqual({
      observedAt,
      outcome: "transiently-unavailable",
      reason: "warming",
      sourceUpdatedAt: null,
    });
  });

  it("maps an invalid content payload to the notices transient failure without a partial snapshot", async () => {
    const publicServices = services();
    publicServices.getContent.mockResolvedValue(null as never);
    const { loader } = loaderFor(publicServices);
    await expect(
      loader(input("https://ferry.fyi/clinton/terminal"))
    ).rejects.toMatchObject({ source: "notices" });
  });
});
