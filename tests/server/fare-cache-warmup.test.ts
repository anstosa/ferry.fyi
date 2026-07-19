import { describe, expect, it, vi } from "vitest";

import type { FareTripRequest } from "../../shared/contracts/fares";
import type { FareAdapter } from "../../server/lib/wsf/fares";
import {
  currentFareTripDate,
  warmTodayFareCatalogs,
} from "../../server/lib/fareCache";
import type { FareCatalogStore } from "../../server/lib/fares";
import { FARE_COLLECTION_POLICY } from "../../shared/lib/fareCollectionPolicy";

describe("fare catalog warmup", () => {
  it("uses the Pacific ferry service day across midnight", () => {
    expect(currentFareTripDate(new Date("2026-07-20T06:59:00.000Z"))).toBe(
      "2026-07-19"
    );
    expect(currentFareTripDate(new Date("2026-07-20T07:00:00.000Z"))).toBe(
      "2026-07-20"
    );
  });

  it("warms every fare-collection direction and skips no-fare directions", async () => {
    const getCatalog = vi.fn(async (request: FareTripRequest) => ({
      collectionDescription: null,
      fares: [],
      freshness: {
        fetchedAt: 1,
        policyVersion: "test",
        sourceCacheFlushDate: "generation",
        validFrom: request.tripDate,
        validThrough: request.tripDate,
      },
      kind: "catalog" as const,
      request,
    }));
    const adapter = { getCatalog } as unknown as FareAdapter;
    const save = vi.fn().mockResolvedValue(undefined);
    const store = { save } as unknown as FareCatalogStore;

    await warmTodayFareCatalogs(new Date("2026-07-20T07:00:00.000Z"), {
      adapter,
      store,
    });

    const collectedDirections = FARE_COLLECTION_POLICY.filter(
      ({ fareCollected }) => fareCollected
    );
    expect(getCatalog).toHaveBeenCalledTimes(collectedDirections.length);
    expect(save).toHaveBeenCalledTimes(collectedDirections.length);
    expect(getCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        arrivingTerminalId: "13",
        departingTerminalId: "1",
        tripDate: "2026-07-20",
      })
    );
    expect(getCatalog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        arrivingTerminalId: "1",
        departingTerminalId: "13",
      })
    );
  });
});
