import { describe, expect, it } from "vitest";

import {
  isFavoriteRoute,
  normalizeFavoriteRouteIds,
  toggleFavoriteRoute,
} from "../../client/lib/favoriteRoutes";
import {
  RouteGroup,
  hasFavoriteRoute,
  sortRouteGroups,
} from "../../client/lib/routeGroups";
import type { Terminal } from "../../shared/contracts/terminals";

const terminal = (id: string): Terminal => ({ id, name: `Terminal ${id}` }) as Terminal;

const group = ({
  annualTraffic,
  id,
  routeIds,
  terminalIds = [],
}: {
  annualTraffic: number;
  id: string;
  routeIds: string[];
  terminalIds?: string[];
}): RouteGroup => ({
  annualTraffic,
  id,
  label: id,
  routeIds,
  terminals: terminalIds.map(terminal),
});

describe("favorite route helpers", () => {
  it("normalizes favorites for stable storage", () => {
    expect(normalizeFavoriteRouteIds(["9", "3", "9", "14"])).toEqual([
      "14",
      "3",
      "9",
    ]);
  });

  it("toggles a route favorite", () => {
    expect(toggleFavoriteRoute(["3"], "9")).toEqual(["3", "9"]);
    expect(toggleFavoriteRoute(["3", "9"], "3")).toEqual(["9"]);
  });

  it("checks optional favorite route ids", () => {
    expect(isFavoriteRoute(["5"], "5")).toBe(true);
    expect(isFavoriteRoute(["5"], undefined)).toBe(false);
  });
});

describe("home favorite route ordering", () => {
  const groups = [
    group({ annualTraffic: 300, id: "high-traffic", routeIds: ["1"], terminalIds: ["1"] }),
    group({ annualTraffic: 200, id: "favorite", routeIds: ["2"], terminalIds: ["2"] }),
    group({ annualTraffic: 100, id: "low-traffic", routeIds: ["3"], terminalIds: ["3"] }),
  ];

  it("moves groups with favorited routes above non-favorites", () => {
    expect(sortRouteGroups(groups, null, ["2"]).map(({ id }) => id)).toEqual([
      "favorite",
      "high-traffic",
      "low-traffic",
    ]);
  });

  it("keeps the closest GPS group above favorite groups", () => {
    expect(sortRouteGroups(groups, terminal("1"), ["2"]).map(({ id }) => id)).toEqual([
      "high-traffic",
      "favorite",
      "low-traffic",
    ]);
  });

  it("detects route group favorites", () => {
    expect(hasFavoriteRoute(groups[1], ["2"])).toBe(true);
    expect(hasFavoriteRoute(groups[1], ["3"])).toBe(false);
  });
});
