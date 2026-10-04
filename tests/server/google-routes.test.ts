import { describe, expect, it, vi } from "vitest";

import {
  createGoogleRoutesAdapter,
  GOOGLE_ROUTES_ENDPOINT,
  type GoogleRoutesUsageRecorder,
} from "../../server/lib/googleRoutes";

const DESTINATION = { latitude: 47.975, longitude: -122.349 };

/** Creates a JSON response fixture. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

/** creates a successful non-ferry route fixture */
function route(duration = "600s", staticDuration?: string) {
  return {
    duration,
    legs: [
      {
        steps: [
          {
            navigationInstruction: { maneuver: "TURN_LEFT" },
            travelMode: "DRIVE",
          },
        ],
      },
    ],
    staticDuration,
    warnings: ["Use caution"],
  };
}

describe("Google Routes adapter", () => {
  // route from the selected place rather than geocoding prediction display text again
  it("uses selected place ids directly without requesting address geocoding fields", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ routes: [route()] }));
    const adapter = createGoogleRoutesAdapter({
      apiKey: "synthetic-key",
      fetchImpl,
    });
    expect(
      (
        await adapter.getGoogleRoute(
          {
            mode: "drive",
            origin: { kind: "place", placeId: "ChIJ_synthetic" },
          },
          DESTINATION
        )
      ).ok
    ).toBe(true);
    const options = fetchImpl.mock.calls[0][1];
    expect(JSON.parse(String(options?.body)).origin).toEqual({
      placeId: "ChIJ_synthetic",
    });
    expect(JSON.stringify(options?.headers)).not.toContain("geocodingResults");
    fetchImpl.mockClear();
    expect(
      (
        await adapter.getGoogleRoute(
          {
            mode: "drive",
            origin: { kind: "place", placeId: "invalid\nidentifier" },
          },
          DESTINATION
        )
      ).ok
    ).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // prove the exact supported drive request and minimal response boundary
  it("sends one traffic-aware fixed-host request without a departure time", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ routes: [route("600s", "540.25s")] })
    );
    const adapter = createGoogleRoutesAdapter({
      apiKey: "server-key",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-10-03T00:00:00.000Z"),
    });

    const result = await adapter.getGoogleRoute(
      {
        mode: "drive",
        origin: { kind: "coordinates", latitude: 47.6, longitude: -122.3 },
      },
      DESTINATION
    );

    expect(result).toEqual({
      ok: true,
      value: {
        durationSeconds: 600,
        partialMatch: false,
        routeRequestedAt: 1_790_985_600,
        staticDurationSeconds: 541,
        trafficAware: true,
        warnings: ["Use caution"],
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(GOOGLE_ROUTES_ENDPOINT);
    expect(options?.headers).toMatchObject({
      "X-Goog-Api-Key": "server-key",
      "X-Goog-FieldMask": [
        "routes.duration",
        "routes.staticDuration",
        "routes.warnings",
        "routes.legs.steps.travelMode",
        "routes.legs.steps.navigationInstruction.maneuver",
        "routes.legs.steps.transitDetails.transitLine.vehicle.type",
        "fallbackInfo.routingMode",
        "fallbackInfo.reason",
      ].join(","),
    });
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({
      routeModifiers: { avoidFerries: true },
      routingPreference: "TRAFFIC_AWARE",
      travelMode: "DRIVE",
    });
    expect(body).not.toHaveProperty("departureTime");
    expect(body).not.toHaveProperty("computeAlternativeRoutes");
  });
  // retain a usable route when its optional traffic-free baseline is malformed or missing
  it.each([undefined, "invalid-duration", "-1s"])(
    "normalizes optional static duration %s to null",
    async (staticDuration) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse({ routes: [route("600s", staticDuration)] })
        );
      const adapter = createGoogleRoutesAdapter({
        apiKey: "server-key",
        fetchImpl,
      });

      const result = await adapter.getGoogleRoute(
        {
          mode: "drive",
          origin: { kind: "coordinates", latitude: 47.6, longitude: -122.3 },
        },
        DESTINATION
      );

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.staticDurationSeconds).toBeNull();
    }
  );

  // keep reviewed entrance provenance out of Google's coordinate schema
  it("allowlists destination coordinates when the registry point includes review metadata", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ routes: [route()] }));
    const point = {
      ...DESTINATION,
      boundary: "vehicle-entrance",
      sourceUrl: "https://wsdot.wa.gov/example",
      verifiedAt: "2026-10-03",
    };
    const result = await createGoogleRoutesAdapter({
      apiKey: "synthetic-key",
      fetchImpl: fetchImpl as typeof fetch,
    }).getGoogleRoute(
      {
        mode: "drive",
        origin: { kind: "coordinates", latitude: 47.6, longitude: -122.3 },
      },
      point
    );
    expect(result.ok).toBe(true);
    expect(
      JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).destination.location
        .latLng
    ).toEqual(DESTINATION);
  });
  // retain the first safe route after rejecting a ferry alternative
  it("selects the first land-only alternative", async () => {
    const ferry = route("300s", "240s");
    ferry.legs[0].steps[0].navigationInstruction.maneuver = "FERRY";
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ routes: [ferry, route("720s", "660.1s")] })
    );
    const adapter = createGoogleRoutesAdapter({
      apiKey: "server-key",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await adapter.getGoogleRoute(
      {
        mode: "walk",
        origin: { kind: "coordinates", latitude: 47.6, longitude: -122.3 },
      },
      DESTINATION
    );

    expect(result.ok && result.value.durationSeconds).toBe(720);
    expect(result.ok && result.value.staticDurationSeconds).toBe(661);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.computeAlternativeRoutes).toBe(true);
    expect(body).not.toHaveProperty("routeModifiers");
    expect(body).not.toHaveProperty("routingPreference");
  });

  // fail closed when a transit vehicle cannot rule out ferry travel
  it.each([undefined, "OTHER", "TRANSIT_VEHICLE_TYPE_UNSPECIFIED", "FERRY"])(
    "rejects ambiguous transit type %s",
    async (type) => {
      const transitRoute = route();
      transitRoute.legs[0].steps[0] = {
        navigationInstruction: { maneuver: "STRAIGHT" },
        transitDetails: {
          transitLine: { vehicle: type ? { type } : {} },
        },
        travelMode: "TRANSIT",
      } as (typeof transitRoute.legs)[number]["steps"][number];
      const adapter = createGoogleRoutesAdapter({
        apiKey: "server-key",
        fetchImpl: vi.fn(async () =>
          jsonResponse({ routes: [transitRoute] })
        ) as typeof fetch,
      });

      await expect(
        adapter.getGoogleRoute(
          {
            mode: "transit",
            origin: {
              kind: "coordinates",
              latitude: 47.6,
              longitude: -122.3,
            },
          },
          DESTINATION
        )
      ).resolves.toEqual({ ok: false, reason: "ferry-route-recursion" });
    }
  );

  // reject partial manual geocoding while avoiding Place ID retention
  it("rejects a partial manual origin", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        geocodingResults: {
          origin: {
            geocoderStatus: { code: 0 },
            partialMatch: true,
            placeId: "transient-place-id",
          },
        },
        routes: [route()],
      })
    );
    const adapter = createGoogleRoutesAdapter({
      apiKey: "server-key",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await adapter.getGoogleRoute(
      { mode: "bicycle", origin: { address: "Mulkiteo", kind: "address" } },
      DESTINATION
    );

    expect(result).toEqual({ ok: false, reason: "origin-needs-correction" });
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      "X-Goog-FieldMask": expect.stringContaining(
        "geocodingResults.origin.partialMatch"
      ),
    });
  });

  // preserve billing outcomes independently from response parsing
  it("counts every 2xx as success and received non-2xx as failure", async () => {
    const outcomes: string[] = [];
    const usage: GoogleRoutesUsageRecorder = {
      // capture the immutable month handle
      async open(sku) {
        return { month: "2026-09", sku };
      },
      // capture the completion classification
      async complete(_handle, outcome) {
        outcomes.push(outcome);
      },
    };
    const malformedAdapter = createGoogleRoutesAdapter({
      apiKey: "server-key",
      fetchImpl: vi.fn(
        async () => new Response("not-json", { status: 200 })
      ) as typeof fetch,
      usage,
    });
    const quotaAdapter = createGoogleRoutesAdapter({
      apiKey: "server-key",
      fetchImpl: vi.fn(
        async () => new Response(null, { status: 429 })
      ) as typeof fetch,
      usage,
    });
    const request = {
      mode: "drive" as const,
      origin: {
        kind: "coordinates" as const,
        latitude: 47.6,
        longitude: -122.3,
      },
    };

    await expect(
      malformedAdapter.getGoogleRoute(request, DESTINATION)
    ).resolves.toEqual({ ok: false, reason: "provider-unavailable" });
    await expect(
      quotaAdapter.getGoogleRoute(request, DESTINATION)
    ).resolves.toEqual({ ok: false, reason: "provider-quota-unavailable" });
    expect(outcomes).toEqual(["success", "known-failure"]);
  });

  // prevent paid requests when the durable attempt cannot be opened
  it("fails closed before provider I/O when usage accounting cannot open", async () => {
    const fetchImpl = vi.fn();
    const complete = vi.fn();
    const adapter = createGoogleRoutesAdapter({
      apiKey: "server-key",
      fetchImpl: fetchImpl as typeof fetch,
      usage: {
        complete,
        open: vi.fn().mockRejectedValue(new Error("accounting unavailable")),
      },
    });

    await expect(
      adapter.getGoogleRoute(
        {
          mode: "drive",
          origin: { kind: "coordinates", latitude: 47.6, longitude: -122.3 },
        },
        DESTINATION
      )
    ).resolves.toEqual({ ok: false, reason: "provider-unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  // suppress estimates when a received response cannot be completed durably
  it.each([200, 429])(
    "fails closed when HTTP %i completion cannot be persisted",
    async (status) => {
      const complete = vi
        .fn()
        .mockRejectedValue(new Error("accounting unavailable"));
      const fetchImpl = vi.fn(() =>
        Promise.resolve(
          status === 200
            ? jsonResponse({ routes: [route()] })
            : new Response(null, { status })
        )
      );
      const adapter = createGoogleRoutesAdapter({
        apiKey: "server-key",
        fetchImpl: fetchImpl as typeof fetch,
        usage: {
          complete,
          open: vi.fn().mockResolvedValue({
            month: "2026-10",
            sku: "compute_routes_pro",
          }),
        },
      });

      await expect(
        adapter.getGoogleRoute(
          {
            mode: "drive",
            origin: {
              kind: "coordinates",
              latitude: 47.6,
              longitude: -122.3,
            },
          },
          DESTINATION
        )
      ).resolves.toEqual({ ok: false, reason: "provider-unavailable" });
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(complete).toHaveBeenCalledWith(
        { month: "2026-10", sku: "compute_routes_pro" },
        status === 200 ? "success" : "known-failure"
      );
    }
  );

  // bound one provider attempt without completing an unresolved response
  it("aborts a stalled provider request without retrying", async () => {
    vi.useFakeTimers();
    const complete = vi.fn();
    const fetchImpl = vi.fn(
      (_url, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // model fetch cancellation at the provider boundary
          options?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true }
          );
        })
    );
    try {
      const adapter = createGoogleRoutesAdapter({
        apiKey: "server-key",
        fetchImpl: fetchImpl as typeof fetch,
        usage: {
          complete,
          open: vi.fn().mockResolvedValue({
            month: "2026-10",
            sku: "compute_routes_pro",
          }),
        },
      });
      const outcome = adapter.getGoogleRoute(
        {
          mode: "drive",
          origin: { kind: "coordinates", latitude: 47.6, longitude: -122.3 },
        },
        DESTINATION
      );

      await vi.advanceTimersByTimeAsync(2_500);
      await expect(outcome).resolves.toEqual({
        ok: false,
        reason: "provider-timeout",
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(complete).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // stop before provider I/O when configuration is unavailable
  it("fails closed without an API key", async () => {
    const fetchImpl = vi.fn();
    const adapter = createGoogleRoutesAdapter({
      apiKey: "",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      adapter.getGoogleRoute(
        {
          mode: "drive",
          origin: { kind: "coordinates", latitude: 47.6, longitude: -122.3 },
        },
        DESTINATION
      )
    ).resolves.toEqual({ ok: false, reason: "configuration-unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ensure database latency never shifts a leave-now route to an earlier instant
describe("Google route fetch clock", () => {
  it("opens the original month handle then timestamps immediately before fetch", async () => {
    let clock = new Date("2026-11-01T06:59:59Z");
    const complete = vi.fn();
    const usage: GoogleRoutesUsageRecorder = {
      // simulate accounting across the Pacific month boundary
      open: async (sku, at) => {
        expect(at.toISOString()).toBe("2026-11-01T06:59:59.000Z");
        clock = new Date("2026-11-01T07:00:04Z");
        return { month: "2026-10", sku };
      },
      complete,
    };
    const fetchImpl = vi.fn(async () => jsonResponse({ routes: [route()] }));
    const result = await createGoogleRoutesAdapter({
      apiKey: "synthetic-key",
      usage,
      now: () => clock,
      fetchImpl: fetchImpl as typeof fetch,
    }).getGoogleRoute(
      {
        mode: "drive",
        origin: { kind: "coordinates", latitude: 47.6, longitude: -122.3 },
      },
      DESTINATION
    );
    expect(result.ok && result.value.routeRequestedAt).toBe(
      clock.getTime() / 1000
    );
    expect(complete).toHaveBeenCalledWith(
      { month: "2026-10", sku: "compute_routes_pro" },
      "success"
    );
  });
  // require typed transit evidence from the same mode rather than using walking as a fallback
  it.each([
    { duration: "600s" },
    { duration: "600s", legs: [] },
    { duration: "600s", legs: [{ steps: [] }] },
    { ...route(), legs: [{ steps: [{ travelMode: "WALK" }] }] },
  ])(
    "rejects transit alternatives without transit evidence",
    async (candidate) => {
      const result = await createGoogleRoutesAdapter({
        apiKey: "synthetic-key",
        fetchImpl: vi.fn(async () =>
          jsonResponse({ routes: [candidate] })
        ) as typeof fetch,
      }).getGoogleRoute(
        {
          mode: "transit",
          origin: { kind: "coordinates", latitude: 47.6, longitude: -122.3 },
        },
        DESTINATION
      );
      expect(result).toEqual({ ok: false, reason: "ferry-route-recursion" });
    }
  );
});
