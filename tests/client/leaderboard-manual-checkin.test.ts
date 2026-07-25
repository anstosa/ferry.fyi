// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getAccessTokenSilently: vi.fn(() => Promise.resolve("access-token")),
  isAuthenticated: true,
  loginWithRedirect: vi.fn(),
}));
const location = vi.hoisted(() => ({ requestForegroundLocation: vi.fn() }));
const leaderboards = vi.hoisted(() => ({
  getLeaderboardPreferences: vi.fn(() =>
    Promise.resolve({
      automaticCheckinsEnabled: true,
      displayName: "AS",
      notificationsEnabled: false,
      optedOut: false,
      useFullName: false,
      verboseNotificationsEnabled: false,
    })
  ),
  getTerminalCheckInStatus: vi.fn(),
  getVesselCheckInStatus: vi.fn(),
  submitTerminalCheckIn: vi.fn(),
  submitVesselCheckIn: vi.fn(),
}));

vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth }));
vi.mock("~/lib/geo", () => location);
vi.mock("~/lib/leaderboards", () => leaderboards);
vi.mock("~/lib/leaderboardForeground", () => ({ vesselSailingId: vi.fn() }));
vi.mock("~/lib/vessels", () => ({ getVessels: vi.fn() }));
vi.mock("~/lib/leaderboardNotifications", () => ({
  notifyLeaderboardCheckIn: vi.fn(),
}));
vi.mock("~/static/images/icons/solid/check-circle.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/location.svg", () => ({
  default: () => null,
}));

import { LeaderboardManualCheckIn } from "../../client/components/LeaderboardManualCheckIn";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("LeaderboardManualCheckIn", () => {
  it("uses a fresh foreground fix and shows a checked-in banner only after server credit", async () => {
    leaderboards.getTerminalCheckInStatus.mockResolvedValue({
      checkedIn: false,
    });
    location.requestForegroundLocation.mockResolvedValue({
      accuracyMeters: 10,
      latitude: 47.6,
      longitude: -122.4,
      observedAt: "2026-07-24T12:00:00.000Z",
    });
    leaderboards.submitTerminalCheckIn.mockResolvedValue({ credited: true });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(LeaderboardManualCheckIn, {
          entityId: "1",
          kind: "terminal",
          name: "Anacortes",
        })
      );
      await Promise.resolve();
    });
    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(leaderboards.submitTerminalCheckIn).toHaveBeenCalledWith(
      {
        accuracyMeters: 10,
        latitude: 47.6,
        longitude: -122.4,
        observedAt: "2026-07-24T12:00:00.000Z",
        terminalId: "1",
      },
      "access-token"
    );
    expect(container.textContent).toContain("You're checked in");
  });
});
