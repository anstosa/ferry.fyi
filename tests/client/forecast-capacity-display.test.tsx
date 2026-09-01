// @vitest-environment jsdom

import { DateTime } from "luxon";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { ForecastFullRisk, Slot } from "shared/contracts/schedules";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const updateUser = vi.hoisted(() => vi.fn());

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
vi.mock("~/lib/device", () => ({ useDevice: () => null }));
vi.mock("~/lib/featureFlags", () => ({
  useFeatureFlags: () => ({ leaderboardsEnabled: false }),
}));
vi.mock("~/lib/generated/vesselAssets", () => ({ vesselAssets: {} }));
vi.mock("~/lib/onboardTracking", () => ({
  useTrackedVessel: () => [null, vi.fn()],
}));
vi.mock("~/lib/user", () => ({
  useUser: () => [
    { alertRules: [], isUserLoading: false },
    { updateUser },
  ],
}));
vi.mock("../../client/views/Schedule/VesselStatusView", () => ({
  VesselStatus: () => null,
}));

import { Capacity } from "../../client/views/Schedule/Capacity";
import { SlotInfo } from "../../client/views/Schedule/SlotInfo";

let root: Root | undefined;

// resize observer test double
class ResizeObserverMock {
  // ignore disconnects
  disconnect(): void {}
  // ignore observations
  observe(): void {}
  // ignore removals
  unobserve(): void {}
}

beforeAll(() => {
  globalThis.ResizeObserver = ResizeObserverMock;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// build one forecast sailing
const createSlot = ({
  fullRisk,
  spacesLeft,
  withLiveCapacity = false,
}: {
  fullRisk: ForecastFullRisk;
  spacesLeft: number;
  withLiveCapacity?: boolean;
}): Slot => ({
  allowsPassengers: true,
  allowsVehicles: true,
  crossing: withLiveCapacity
    ? {
        arrivalId: "arrival",
        departureDelta: null,
        departureId: "departure",
        departureTime: 2_000_000_000,
        driveUpCapacity: 30,
        hasDriveUp: true,
        hasReservations: false,
        isCancelled: false,
        reservableCapacity: 0,
        totalCapacity: 141,
      }
    : undefined,
  estimate: {
    confidence: "high",
    driveUpCapacity: spacesLeft,
    factors: [],
    fullProbability: fullRisk === "likely" ? 0.6 : 0.34,
    fullRisk,
    reservableCapacity: 0,
  },
  hasPassed: false,
  mateId: "14",
  time: 2_000_000_000,
  vessel: {
    abbreviation: "TEST",
    beam: "80 ft",
    classId: "test",
    hasCarDeckRestroom: true,
    hasElevator: true,
    hasGalley: false,
    hasRestroom: true,
    hasWiFi: false,
    horsepower: 1,
    id: "test-vessel",
    inMaintenance: false,
    inService: true,
    info: {},
    isAdaAccessible: true,
    maxClearance: 15,
    name: "Test Vessel",
    passengerCapacity: 1_000,
    speed: 0,
    tallVehicleCapacity: 0,
    vehicleCapacity: 141,
    vesselWatchUrl: "",
    weight: 1,
    yearBuilt: 2000,
  },
  wuid: `test-${fullRisk}-${spacesLeft}-${withLiveCapacity}`,
});

// render one client component
const render = (element: React.ReactElement): HTMLElement => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(element));
  return container;
};

// render one sailing row
const renderSlotInfo = (slot: Slot): HTMLElement =>
  render(
    <MemoryRouter>
      <SlotInfo
        initialDetailTab="forecast"
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
  );

describe("forecast capacity display", () => {
  // schedule-row practical-full boundary
  it("rounds forecasts over ninety percent full to full", () => {
    const slot = createSlot({ fullRisk: "unlikely", spacesLeft: 3 });
    const container = render(
      <Capacity hasDeparted={false} isDaylight slot={slot} />
    );

    expect(container.textContent).toContain("Boat full");
    expect(container.textContent).not.toContain("3 spaces left");
  });

  // schedule-row non-full boundary
  it("keeps spaces for forecasts below ninety percent full", () => {
    const slot = createSlot({ fullRisk: "unlikely", spacesLeft: 15 });
    const container = render(
      <Capacity hasDeparted={false} isDaylight slot={slot} />
    );

    expect(container.textContent).toContain("15 spaces left");
    expect(container.textContent).not.toContain("Boat full");
  });

  // schedule-row expected-full state
  it("hides spaces for likely-full forecasts", () => {
    const slot = createSlot({ fullRisk: "likely", spacesLeft: 20 });
    const container = render(
      <Capacity hasDeparted={false} isDaylight slot={slot} />
    );

    expect(container.textContent).toContain("Boat full");
    expect(container.textContent).not.toContain("20 spaces left");
  });

  // detail-card practical-full boundary
  it("rounds practical-full detail forecasts without hiding calibrated risk", () => {
    const container = renderSlotInfo(
      createSlot({ fullRisk: "unlikely", spacesLeft: 3 })
    );

    expect(container.textContent).toContain("100% full");
    expect(container.textContent).toContain("Boat full");
    expect(container.textContent).toContain("Near capacity");
    expect(container.textContent).not.toContain("3 spaces left");
  });

  // detail-card expected-full state
  it("shows likely forecasts as full without a space count", () => {
    const container = renderSlotInfo(
      createSlot({ fullRisk: "likely", spacesLeft: 20 })
    );

    expect(container.textContent).toContain("100% full");
    expect(container.textContent).toContain("Boat full");
    expect(container.textContent).toContain("Full sailing risk");
    expect(container.textContent).toContain("60% likelihood");
    expect(container.textContent).not.toContain("20 spaces left");
  });

  // confirmed-capacity precedence
  it("keeps informative live spaces visible beside a likely forecast", () => {
    const container = renderSlotInfo(
      createSlot({
        fullRisk: "likely",
        spacesLeft: 20,
        withLiveCapacity: true,
      })
    );

    expect(container.textContent).toContain("30 spaces left");
  });
});
