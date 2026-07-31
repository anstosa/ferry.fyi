// @vitest-environment jsdom
import { createStore, Provider } from "jotai";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("~/lib/api", () => api);
vi.mock("~/lib/geo", () => ({
  getDistance: () => 0,
  useGeo: () => [null],
}));

import { PublicSsrSeedProvider } from "../../client/lib/ssrSeed";
import { useTerminals } from "../../client/lib/terminals";
import {
  PUBLIC_SSR_SNAPSHOT_VERSION,
  type PublicSsrPayloadMap,
  type PublicSsrSnapshot,
} from "../../shared/contracts/ssr";

const terminal = (
  id: string,
  name: string
): PublicSsrPayloadMap["terminals"][number] => ({
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
  location: {
    address: { city: null, line1: null, line2: null, state: null, zip: null },
    latitude: 1,
    link: null,
    longitude: 1,
  },
  mates: [],
  name,
  popularity: 0,
  routes: {},
  terminalUrl: null,
  vesselWatchUrl: null,
  waitTimes: [],
});
const seed: PublicSsrPayloadMap["terminals"] = [
  terminal("b", "Beta"),
  terminal("a", "Alpha"),
];

const snapshot = {
  canonicalHost: "ferry.fyi",
  canonicalPath: "/",
  hostProfile: "ferry.fyi",
  indexability: "indexable",
  metadata: {
    canonicalPath: "/",
    description: "Terminal seed test",
    robots: "index,follow",
    title: "Terminal seed test",
  },
  normalizedUrl: { path: "/", query: {} },
  renderedAt: "2026-07-28T12:00:00.000Z",
  routeId: "home",
  routeParams: {},
  sources: {
    terminals: {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "value",
      sourceUpdatedAt: "2026-07-28T12:00:00.000Z",
      value: seed,
    },
    features: {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "value",
      sourceUpdatedAt: "2026-07-28T12:00:00.000Z",
      value: { leaderboardsEnabled: false },
    },
    notices: {
      observedAt: "2026-07-28T12:00:00.000Z",
      outcome: "value",
      sourceUpdatedAt: "2026-07-28T12:00:00.000Z",
      value: {
        announcements: [],
        maintenance: { enabled: false, message: "" },
      },
    },
  },
  version: PUBLIC_SSR_SNAPSHOT_VERSION,
} satisfies PublicSsrSnapshot;

const Probe = () =>
  React.createElement(
    "output",
    null,
    useTerminals()
      .terminals.map(({ id }) => id)
      .join(",")
  );

describe("terminal SSR seed refresh", () => {
  let root: Root | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("retains the exact seeded terminal order on a rejected refresh", async () => {
    api.get.mockRejectedValue(new Error("offline"));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const store = createStore();
    await act(async () => {
      root?.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            PublicSsrSeedProvider,
            { snapshot },
            React.createElement(Probe)
          )
        )
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toBe("a,b");
    expect(seed.map(({ id }) => id)).toEqual(["b", "a"]);
  });

  it("replaces the seed after a successful refresh without mutating it", async () => {
    api.get.mockResolvedValue([
      terminal("c", "Charlie"),
      terminal("d", "Delta"),
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const store = createStore();
    await act(async () => {
      root?.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            PublicSsrSeedProvider,
            { snapshot },
            React.createElement(Probe)
          )
        )
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toBe("c,d");
    expect(seed.map(({ id }) => id)).toEqual(["b", "a"]);
  });
});
