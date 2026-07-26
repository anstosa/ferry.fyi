// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LeaderboardPreferences } from "../../shared/contracts/leaderboards";

const auth = vi.hoisted(() => ({
  getAccessTokenSilently: vi.fn(() => Promise.resolve("access-token")),
  isAuthenticated: true,
}));
const leaderboards = vi.hoisted(() => ({
  getLeaderboardPreferences: vi.fn(),
  isLeaderboardForegroundCheckinsEnabled: vi.fn(() => true),
  isLeaderboardVesselsEnabled: vi.fn(() => false),
  submitTerminalCheckIn: vi.fn(),
  submitTerminalDeparture: vi.fn(),
  submitVesselCheckIn: vi.fn(),
}));
const watcher = vi.hoisted(() => ({
  isOptedOut: true,
  onEnterVessel: false,
  renderCount: 0,
}));
const locationEnrollment = vi.hoisted(() => ({
  initialLeaderboardLocationEnrollmentState: {
    enrollment: "not-enrolled",
    locationAccess: "unavailable",
    notificationAccess: "unavailable",
  },
  LEADERBOARD_LOCATION_ENROLLMENT_CHANGED:
    "leaderboard-location-enrollment-changed",
  LEADERBOARD_LOCATION_ENROLLMENT_STORAGE_KEY:
    "leaderboard-location-enrollment",
  parseLeaderboardLocationEnrollmentState: vi.fn(() => ({
    enrollment: "not-enrolled",
    locationAccess: "unavailable",
    notificationAccess: "unavailable",
  })),
}));

vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth }));
vi.mock("~/lib/leaderboards", () => leaderboards);
vi.mock("~/lib/leaderboardLocation", () => locationEnrollment);
vi.mock("~/lib/leaderboardNotifications", () => ({
  notifyLeaderboardCheckIn: vi.fn(),
}));
vi.mock("~/lib/featureFlags", () => ({
  useFeatureFlags: () => ({
    automaticLeaderboardCheckinsEnabled: true,
    leaderboardsEnabled: true,
    loading: false,
  }),
}));
vi.mock("~/lib/terminals", () => ({ useTerminalList: () => [] }));
vi.mock("../../client/lib/vessels", () => ({ useLiveVessels: () => [] }));
vi.mock("~/components/LeaderboardForegroundCheckinWatcher", () => ({
  LeaderboardForegroundCheckinWatcher: ({
    isOptedOut,
    onEnterVessel,
  }: {
    isOptedOut: boolean;
    onEnterVessel?: unknown;
  }) => {
    watcher.isOptedOut = isOptedOut;
    watcher.onEnterVessel = Boolean(onEnterVessel);
    watcher.renderCount += 1;
    return null;
  },
}));

import { LeaderboardForegroundCheckins } from "../../client/components/LeaderboardForegroundCheckins";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const preferences = (optedOut: boolean): LeaderboardPreferences => ({
  automaticCheckinsEnabled: true,
  displayName: "AS",
  notificationsEnabled: true,
  optedOut,
  useFullName: false,
  verboseNotificationsEnabled: false,
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  watcher.isOptedOut = true;
  watcher.onEnterVessel = false;
  watcher.renderCount = 0;
});

describe("LeaderboardForegroundCheckins", () => {
  it("never mounts a foreground watcher even if a legacy feature response enables automation", async () => {
    leaderboards.getLeaderboardPreferences.mockResolvedValue(preferences(false));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(LeaderboardForegroundCheckins));
      await Promise.resolve();
    });

    expect(watcher.renderCount).toBe(0);
  });

  it("pauses automatic checks when the user selects manual-only check-ins", async () => {
    leaderboards.getLeaderboardPreferences.mockResolvedValue({
      ...preferences(false),
      automaticCheckinsEnabled: false,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(LeaderboardForegroundCheckins));
      await Promise.resolve();
    });

    expect(watcher.isOptedOut).toBe(true);
    expect(watcher.renderCount).toBe(0);
  });
});
