import logger from "~/lib/logger";
import { describe, expect, it, vi } from "vitest";

const compositionMocks = vi.hoisted(() => ({
  captureSnapshotLoader: vi.fn(),
  fareQueries: {
    getCatalog: vi.fn(),
    getDefaultRates: vi.fn(),
    getQuote: vi.fn(),
  },
}));

vi.mock("~/services/public/fares", () => ({
  createPublicFareQueryService: vi.fn(() => compositionMocks.fareQueries),
}));

vi.mock("../../server/ssr/publicSnapshot", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/ssr/publicSnapshot")>();
  return {
    ...actual,
    createPublicSsrSnapshotLoader: compositionMocks.captureSnapshotLoader,
  };
});

import { createSsrRuntime } from "../../server/ssr/composition";
import type { PublicSsrSnapshotServices } from "../../server/ssr/publicSnapshot";

// create the production composition with inert artifacts
const createRuntime = (telemetry?: ReturnType<typeof vi.fn>) =>
  createSsrRuntime({
    artifacts: {
      getRenderer: () =>
        Promise.resolve({
          artifactVersion: 1,
          renderPublicSsrDocument: vi.fn(),
        }),
      getTemplate: () =>
        Promise.resolve(
          '<html><head></head><body><div id="root"></div></body></html>'
        ),
    },
    config: { cacheEnabled: false, enabled: true },
    ...(telemetry ? { telemetry } : {}),
  });

describe("SSR runtime composition telemetry", () => {
  it("uses the structured production logging sink by default", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    await createSsrRuntime({
      artifacts: {
        getRenderer: () =>
          Promise.resolve({
            artifactVersion: 1,
            renderPublicSsrDocument: vi.fn(),
          }),
        getTemplate: () =>
          Promise.resolve(
            '<html><head></head><body><div id="root"></div></body></html>'
          ),
      },
      config: { cacheEnabled: true, enabled: true },
    });

    expect(info).toHaveBeenCalledWith("Public SSR telemetry", {
      cacheEnabled: true,
      documentsEnabled: true,
      event: "ssr_startup",
    });
    info.mockRestore();
  });

  it("wires an injected production-compatible sink into runtime startup", async () => {
    const telemetry = vi.fn();
    await createSsrRuntime({
      artifacts: {
        getRenderer: () =>
          Promise.resolve({
            artifactVersion: 1,
            renderPublicSsrDocument: vi.fn(),
          }),
        getTemplate: () =>
          Promise.resolve(
            '<html><head></head><body><div id="root"></div></body></html>'
          ),
      },
      config: { cacheEnabled: false, enabled: true },
      telemetry,
    });

    expect(telemetry).toHaveBeenCalledWith({
      cacheEnabled: false,
      documentsEnabled: true,
      event: "ssr_startup",
    });
  });

  // retain default-rate enrichment in the production fare composition boundary
  it("enriches the production SSR fare outcome after catalog lookup", async () => {
    const input = {
      arrivingTerminalId: "14",
      departingTerminalId: "5",
      roundTrip: false,
      tripDate: "2026-08-01" as const,
    };
    const freshness = {
      fetchedAt: 1_775_000_000,
      policyVersion: "test-v1",
      sourceCacheFlushDate: "generation-1",
      validFrom: "2026-07-01" as const,
      validThrough: "2026-08-31" as const,
    };
    const outcome = {
      catalog: {
        collectionDescription: null,
        fares: [],
        freshness,
        kind: "catalog" as const,
        request: input,
      },
      kind: "catalog" as const,
    };
    const defaultRates = {
      passenger: {
        oneWay: { amount: 11.35, freshness, state: "current" as const },
        roundTrip: null,
      },
      standardVehicle: { oneWay: null, roundTrip: null },
    };
    compositionMocks.fareQueries.getCatalog.mockResolvedValueOnce(outcome);
    compositionMocks.fareQueries.getDefaultRates.mockResolvedValueOnce(
      defaultRates
    );
    compositionMocks.captureSnapshotLoader.mockImplementationOnce(
      ({ services }: { services: PublicSsrSnapshotServices }) => {
        void services;
        return vi.fn();
      }
    );

    await createRuntime(vi.fn());
    const [{ services }] = compositionMocks.captureSnapshotLoader.mock.calls.at(
      -1
    ) as [{ services: PublicSsrSnapshotServices }];

    await expect(services.getFareCatalog(input)).resolves.toEqual({
      ...outcome,
      defaultRates,
    });
    expect(compositionMocks.fareQueries.getCatalog).toHaveBeenCalledWith(input);
    expect(compositionMocks.fareQueries.getDefaultRates).toHaveBeenCalledWith(
      outcome,
      input
    );
  });
});
