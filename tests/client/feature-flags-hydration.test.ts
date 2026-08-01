// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    getAccessTokenSilently: vi.fn(),
    isAuthenticated: false,
  },
  get: vi.fn(),
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => mocks.auth,
}));
vi.mock("~/lib/api", () => ({ get: mocks.get }));

import {
  FeatureFlagProvider,
  useFeatureFlags,
} from "../../client/lib/featureFlags";
import {
  AppRenderProvider,
  type AppRuntime,
} from "../../client/lib/renderContext";
import { PublicSsrSeedProvider } from "../../client/lib/ssrSeed";
import {
  PUBLIC_SSR_SNAPSHOT_VERSION,
  type PublicSsrSnapshot,
} from "../../shared/contracts/ssr";

const snapshot = {
  canonicalHost: "ferry.fyi",
  canonicalPath: "/",
  hostProfile: "ferry.fyi",
  indexability: "indexable",
  metadata: {
    canonicalPath: "/",
    description: "Flags",
    robots: "index,follow",
    title: "Ferry FYI",
  },
  normalizedUrl: { path: "/", query: {} },
  renderedAt: "2026-07-29T12:00:00.000Z",
  routeId: "home",
  routeParams: {},
  sources: {
    features: {
      observedAt: "2026-07-29T12:00:00.000Z",
      outcome: "value",
      sourceUpdatedAt: "2026-07-29T12:00:00.000Z",
      value: { leaderboardsEnabled: true },
    },
  },
  version: PUBLIC_SSR_SNAPSHOT_VERSION,
} as PublicSsrSnapshot;

const Probe = () => {
  const flags = useFeatureFlags();
  return React.createElement("output", null, JSON.stringify(flags));
};

const Tree = ({ runtime }: { runtime: AppRuntime }) =>
  React.createElement(
    AppRenderProvider,
    {
      value: {
        clock: () => 0,
        hasInjectedRequest: true,
        platform: "web",
        requestUrl: "https://ferry.fyi/",
        runtime,
        seoBaseUrl: "https://ferry.fyi",
        seoHost: "ferry.fyi",
        seoPathname: "/",
      },
    },
    React.createElement(
      PublicSsrSeedProvider,
      { snapshot },
      React.createElement(FeatureFlagProvider, null, React.createElement(Probe))
    )
  );

describe("feature flag hydration seed", () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    mocks.auth.isAuthenticated = false;
    vi.clearAllMocks();
  });

  it("keeps the seed for hydration, then accepts live anonymous flags", async () => {
    mocks.get.mockResolvedValue({ leaderboardsEnabled: false });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(React.createElement(Tree, { runtime: "hydrate" }));
    });
    expect(container.textContent).toContain('"leaderboardsEnabled":true');

    await act(async () => {
      root?.render(React.createElement(Tree, { runtime: "browser" }));
      await Promise.resolve();
    });
    expect(mocks.get).toHaveBeenCalledWith("/features");
    expect(container.textContent).toContain('"leaderboardsEnabled":false');
  });

  it("keeps the public seed visible while browser flags are loading", async () => {
    let resolveFlags:
      | ((value: { leaderboardsEnabled: boolean }) => void)
      | undefined;
    mocks.get.mockReturnValue(
      new Promise((resolve) => {
        resolveFlags = resolve;
      })
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(Tree, { runtime: "browser" }));
      await Promise.resolve();
    });
    expect(container.textContent).toContain('"leaderboardsEnabled":true');

    await act(async () => {
      resolveFlags?.({ leaderboardsEnabled: false });
      await Promise.resolve();
    });
    expect(container.textContent).toContain('"leaderboardsEnabled":false');
  });

  it("accepts authenticated flags without widening the private allowlist", async () => {
    mocks.auth.isAuthenticated = true;
    mocks.auth.getAccessTokenSilently.mockResolvedValue("private-token");
    mocks.get.mockResolvedValue({
      automaticLeaderboardCheckinsEnabled: true,
      leaderboardsEnabled: true,
      ownerAdminEnabled: true,
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(Tree, { runtime: "browser" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.get).toHaveBeenCalledWith("/features/me", "private-token");
    expect(container.textContent).toBe(
      '{"automaticLeaderboardCheckinsEnabled":false,"leaderboardsEnabled":true,"loading":false}'
    );
    expect(container.textContent).not.toContain("ownerAdminEnabled");
  });
});
