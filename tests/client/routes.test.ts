import { matchRoutes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { createAppRoutes } from "../../client/routes";

describe("manifest-driven browser routes", () => {
  it("preserves the Leaderboards nested route remainder", () => {
    const routes = createAppRoutes((_label, element) => element);
    const leaderboardRoutes = routes.filter((route) =>
      route.path?.startsWith("/leaderboards")
    );
    expect(leaderboardRoutes).toHaveLength(1);
    expect(leaderboardRoutes[0].path).toBe("/leaderboards/*");

    for (const [pathname, remainder] of [
      ["/leaderboards", ""],
      ["/leaderboards/settings", "settings"],
      ["/leaderboards/terminals/seattle", "terminals/seattle"],
      ["/leaderboards/vessels/kaleetan", "vessels/kaleetan"],
      ["/leaderboards/unknown", "unknown"],
    ]) {
      const match = matchRoutes(routes, pathname);
      expect(match).toHaveLength(1);
      expect(match?.[0].route).toBe(leaderboardRoutes[0]);
      expect(match?.[0].params["*"]).toBe(remainder);
    }
  });
});
