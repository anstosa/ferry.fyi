import { describe, expect, it } from "vitest";

import { getServiceWorkerApiPolicy } from "../../client/lib/serviceWorkerApiPolicy";

const classify = (
  path: string,
  {
    authorization,
    method = "GET",
  }: { authorization?: string; method?: string } = {}
) => {
  const url = new URL(path, "https://ferry.fyi");
  return getServiceWorkerApiPolicy({
    request: new Request(url, {
      headers: authorization ? { Authorization: authorization } : {},
      method,
    }),
    url,
  });
};

describe("service-worker API cache privacy", () => {
  it.each([
    "/api/user",
    "/api/ads",
    "/api/admin/operations",
    "/api/tickets/example",
    "/api/leaderboards/checkins/terminals/7",
    "/api/vessels/refresh",
    "/api/vessels/snapshot",
    "/api/cameras/frames?ids=1",
    "/api/terminals/1",
    "/api/schedule/7/3",
  ])("keeps %s on the network", (path) => {
    expect(classify(path)).toBe("network-only");
  });

  it("never changes policy for Authorization-bearing requests", () => {
    expect(classify("/api/features", { authorization: "Bearer private" })).toBe(
      "network-only"
    );
  });

  it("does not intercept another origin or non-API asset", () => {
    const external = new URL("https://example.com/api/features");
    expect(
      getServiceWorkerApiPolicy({
        request: new Request("https://ferry.fyi/api/features"),
        url: external,
      })
    ).toBeNull();
    expect(classify("/static/icon.png")).toBeNull();
  });
});
