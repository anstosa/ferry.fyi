import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("~/lib/api", () => api);

import { getFareCatalog, getFareCatalogUrl, getFareQuote } from "../../client/lib/fares";

describe("fare client API", () => {
  it("requests the anonymous catalog for the exact route and date", async () => {
    api.get.mockResolvedValueOnce({ state: "unavailable" });

    await getFareCatalog(
      { id: "1" } as never,
      { id: "2" } as never,
      DateTime.fromISO("2026-07-18")
    );

    expect(api.get).toHaveBeenCalledWith(
      "/fares/catalog?arrivingTerminalId=2&departingTerminalId=1&tripDate=2026-07-18"
    );
  });

  it("posts quote selections without adding a client-controlled trip mode", async () => {
    const request = {
      arrivingTerminalId: "2",
      departingTerminalId: "1",
      lineItems: [{ fareLineItemId: 17, quantity: 1 }],
      roundTrip: false,
      tripDate: "2026-07-18" as const,
    };
    api.post.mockResolvedValueOnce({ state: "unavailable" });

    await getFareQuote(request);

    expect(api.post).toHaveBeenCalledWith("/fares/quote", request);
  });

  it("encodes catalog inputs safely", () => {
    expect(getFareCatalogUrl("a/b", "c d", "2026-07-18")).toBe(
      "/fares/catalog?arrivingTerminalId=c+d&departingTerminalId=a%2Fb&tripDate=2026-07-18"
    );
  });
});
