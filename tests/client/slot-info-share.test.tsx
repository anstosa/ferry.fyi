// @vitest-environment jsdom

import { DateTime } from "luxon";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { DetailTab } from "../../client/lib/sailingDeepLink";
import { createForecastSlot } from "../fixtures/forecastSlot";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const updateUser = vi.hoisted(() => vi.fn());
// define the sailing-share fixture
const share = vi.hoisted(() => ({
  canShare: vi.fn(() => Promise.resolve({ value: false })),
  share: vi.fn(() => Promise.resolve()),
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    isAuthenticated: false,
    isLoading: false,
    loginWithPopup: vi.fn(),
    loginWithRedirect: vi.fn(),
  }),
}));
vi.mock("framer-motion", async () => {
  const { createElement } = await import("react");
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: {
      div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
        createElement("div", props, children),
    },
  };
});
vi.mock("@capacitor/share", () => ({ Share: share }));
vi.mock("~/lib/device", () => ({ useDevice: () => null }));
vi.mock("~/lib/featureFlags", () => ({
  useFeatureFlags: () => ({ leaderboardsEnabled: false }),
}));
vi.mock("~/lib/generated/vesselAssets", () => ({ vesselAssets: {} }));
vi.mock("~/lib/onboardTracking", () => ({
  useTrackedVessel: () => [null, vi.fn()],
}));
vi.mock("~/lib/user", () => ({
  useUser: () => [{ alertRules: [], isUserLoading: false }, { updateUser }],
}));
vi.mock("../../client/views/Schedule/VesselStatusView", () => ({
  VesselStatus: () => null,
}));

import { SlotInfo } from "../../client/views/Schedule/SlotInfo";

let root: Root | undefined;

// resize observer test double
class ResizeObserverMock {
  // ignore disconnects
  disconnect(): void {
    return undefined;
  }

  // ignore observations
  observe(): void {
    return undefined;
  }

  // ignore removals
  unobserve(): void {
    return undefined;
  }
}

beforeAll(() => {
  globalThis.ResizeObserver = ResizeObserverMock;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  vi.restoreAllMocks();
});

// render one sailing detail
const renderSlotInfo = (
  slot = createForecastSlot({ fullRisk: "unlikely", spacesLeft: 15 }),
  initialDetailTab: DetailTab = "forecast",
  initialEntry = "/"
): HTMLElement => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <SlotInfo
          initialDetailTab={initialDetailTab}
          isExpanded
          location={{ address: {}, latitude: 47.98, longitude: -122.35 }}
          onClick={vi.fn()}
          schedule={[slot]}
          setElement={vi.fn()}
          slot={slot}
          terminalId="5"
          time={DateTime.fromSeconds(slot.time - 60)}
        />
      </MemoryRouter>
    )
  );
  return container;
};

describe("sailing detail sharing", () => {
  // contain denied clipboard fallback
  it("shows a handled error when clipboard access is denied", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValue(new DOMException("Write permission denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const container = renderSlotInfo();
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Share this sailing tab"]'
    );

    await act(async () => {
      button?.click();
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    });

    expect(share.canShare).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to share this sailing link"
    );
  });
});

describe("sailing vessel actions", () => {
  // focused map navigation
  it("replaces boat tracking with an open-in-map link", () => {
    const slot = createForecastSlot({
      fullRisk: "unlikely",
      spacesLeft: 15,
    });
    slot.vessel = {
      ...slot.vessel,
      arrivingTerminalId: 14,
      departingTerminalId: 5,
      location: { latitude: 47.96, longitude: -122.33 },
    };
    const container = renderSlotInfo(slot, "vessel", "/clinton/mukilteo");
    const mapLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/clinton/mukilteo/map?vessel=test-vessel"]'
    );

    expect(mapLink?.textContent).toContain("Open in map");
    expect(mapLink?.querySelector("svg")).not.toBeNull();
    expect(container.textContent).not.toContain("Track Boat");
  });
});
