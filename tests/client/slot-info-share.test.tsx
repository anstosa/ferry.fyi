// @vitest-environment jsdom

import { DateTime } from "luxon";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  createOneTimeSailingAlertRule,
  getRouteSubscriptionKey,
} from "shared/lib/alertSubscriptions";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { DetailTab } from "../../client/lib/sailingDeepLink";
import { createForecastSlot } from "../fixtures/forecastSlot";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  alertRules: [] as unknown[],
  isAuthenticated: false,
  isLoading: false,
  isUserLoading: false,
  requestNotificationPermission: vi.fn(() => Promise.resolve(false)),
  requestPushInitialization: vi.fn(),
  trackUsefulEvent: vi.fn(),
  updateUser: vi.fn(() => Promise.resolve()),
}));
// define the sailing-share fixture
const share = vi.hoisted(() => ({
  canShare: vi.fn(() => Promise.resolve({ value: false })),
  share: vi.fn(() => Promise.resolve()),
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    isAuthenticated: mocks.isAuthenticated,
    isLoading: mocks.isLoading,
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
vi.mock("~/lib/analytics", () => ({
  trackUsefulEvent: mocks.trackUsefulEvent,
}));
vi.mock("~/lib/device", () => ({ useDevice: () => null }));
vi.mock("~/lib/featureFlags", () => ({
  useFeatureFlags: () => ({ leaderboardsEnabled: false }),
}));
vi.mock("~/lib/generated/vesselAssets", () => ({ vesselAssets: {} }));
vi.mock("~/lib/push", () => ({
  requestNotificationPermission: mocks.requestNotificationPermission,
  requestPushInitialization: mocks.requestPushInitialization,
}));
vi.mock("~/lib/user", () => ({
  useUser: () => [
    {
      alertRules: mocks.alertRules,
      isUserLoading: mocks.isUserLoading,
    },
    { updateUser: mocks.updateUser },
  ],
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.alertRules = [];
  mocks.isAuthenticated = false;
  mocks.isLoading = false;
  mocks.isUserLoading = false;
  mocks.requestNotificationPermission.mockResolvedValue(false);
  mocks.updateUser.mockResolvedValue(undefined);
  share.canShare.mockResolvedValue({ value: false });
  share.share.mockResolvedValue(undefined);
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
  // native share success
  it("qualifies a resolved native share with fixed metadata", async () => {
    share.canShare.mockResolvedValue({ value: true });
    const container = renderSlotInfo();
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Share this sailing tab"]'
    );

    await act(async () => {
      button?.click();
      await vi.waitFor(() => expect(share.share).toHaveBeenCalledOnce());
    });

    expect(mocks.trackUsefulEvent).toHaveBeenCalledOnce();
    expect(mocks.trackUsefulEvent).toHaveBeenCalledWith("share_completed", {
      method: "share_sheet",
      surface: "sailing",
    });
  });

  // clipboard fallback success
  it("qualifies a resolved clipboard fallback with fixed metadata", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const container = renderSlotInfo();
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Share this sailing tab"]'
    );

    await act(async () => {
      button?.click();
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    });

    expect(mocks.trackUsefulEvent).toHaveBeenCalledOnce();
    expect(mocks.trackUsefulEvent).toHaveBeenCalledWith("share_completed", {
      method: "clipboard",
      surface: "sailing",
    });
  });

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
    expect(mocks.trackUsefulEvent).not.toHaveBeenCalled();
  });

  // failed share attempts remain silent
  it("stays silent on native cancellation and qualifies a later success", async () => {
    share.canShare.mockResolvedValue({ value: true });
    share.share
      .mockRejectedValueOnce(new DOMException("canceled", "AbortError"))
      .mockResolvedValueOnce(undefined);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const container = renderSlotInfo();
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Share this sailing tab"]'
    );

    await act(async () => {
      button?.click();
      await vi.waitFor(() => expect(share.share).toHaveBeenCalledOnce());
    });
    expect(mocks.trackUsefulEvent).not.toHaveBeenCalled();

    await act(async () => {
      button?.click();
      await vi.waitFor(() => expect(share.share).toHaveBeenCalledTimes(2));
    });
    expect(mocks.trackUsefulEvent).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledOnce();
  });
});

describe("one-time sailing alert analytics", () => {
  // persisted alert without push permission
  it("qualifies a saved alert even when push permission is denied", async () => {
    mocks.isAuthenticated = true;
    const container = renderSlotInfo(undefined, "sailing");
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Add this sailing alert"]'
    );

    await act(async () => {
      button?.click();
      await vi.waitFor(() => expect(mocks.updateUser).toHaveBeenCalledOnce());
    });

    expect(mocks.trackUsefulEvent).toHaveBeenCalledWith("alert_saved", {
      kind: "one_time",
    });
    expect(mocks.requestPushInitialization).not.toHaveBeenCalled();
  });

  // push initialization remains separate
  it("initializes push separately after the same saved milestone", async () => {
    mocks.isAuthenticated = true;
    mocks.requestNotificationPermission.mockResolvedValue(true);
    const container = renderSlotInfo(undefined, "sailing");
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Add this sailing alert"]'
    );

    await act(async () => {
      button?.click();
      await vi.waitFor(() => expect(mocks.updateUser).toHaveBeenCalledOnce());
    });

    expect(mocks.trackUsefulEvent).toHaveBeenCalledWith("alert_saved", {
      kind: "one_time",
    });
    expect(mocks.requestPushInitialization).toHaveBeenCalledOnce();
  });

  // persistence failure remains silent
  it("does not qualify a rejected alert save", async () => {
    mocks.isAuthenticated = true;
    mocks.updateUser.mockRejectedValue(new Error("save failed"));
    const container = renderSlotInfo(undefined, "sailing");
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Add this sailing alert"]'
    );

    await act(async () => {
      button?.click();
      await vi.waitFor(() => expect(mocks.updateUser).toHaveBeenCalledOnce());
    });

    expect(mocks.trackUsefulEvent).not.toHaveBeenCalled();
    expect(container.textContent).toContain("save failed");
  });

  // persisted removals remain silent
  it("does not qualify an existing alert removal", async () => {
    mocks.isAuthenticated = true;
    const slot = createForecastSlot({ fullRisk: "unlikely", spacesLeft: 15 });
    const sailingTime = DateTime.fromSeconds(slot.time);
    const routeKey = getRouteSubscriptionKey(["5", slot.mateId]);
    mocks.alertRules = [
      createOneTimeSailingAlertRule({
        id: "one-time-alert-sentinel",
        routeKey,
        sailingTime,
        terminalIds: ["5"],
      }),
    ];
    const container = renderSlotInfo(slot, "sailing");
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Turn off this sailing alert"]'
    );

    await act(async () => {
      button?.click();
      await vi.waitFor(() => expect(mocks.updateUser).toHaveBeenCalledOnce());
    });

    expect(mocks.trackUsefulEvent).not.toHaveBeenCalled();
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
    expect(mapLink?.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 512 512"
    );
    expect(container.textContent).not.toContain("Track Boat");
  });
});
