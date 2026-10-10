// @vitest-environment jsdom

import { DateTime } from "luxon";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { Slot } from "shared/contracts/schedules";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ProjectedTiming } from "../../client/views/Schedule/projectedTiming";
import { createForecastSlot } from "../fixtures/forecastSlot";

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
vi.mock("~/lib/user", () => ({
  useUser: () => [{ alertRules: [], isUserLoading: false }, { updateUser }],
}));
vi.mock("../../client/views/Schedule/VesselStatusView", () => ({
  VesselStatus: () => null,
}));

import { SlotInfo } from "../../client/views/Schedule/SlotInfo";
import { Time } from "../../client/views/Schedule/Time";

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
  vi.clearAllMocks();
});

// render one client tree
const render = (element: React.ReactElement): HTMLElement => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(element));
  return container;
};

const scheduledTime = DateTime.fromISO("2026-06-21T18:00:00", {
  zone: "America/Los_Angeles",
});

// build projected timing
const createTiming = (isCancelled = false): ProjectedTiming => ({
  delayMins: 0,
  departureTime: scheduledTime,
  isCancelled,
  scheduledTime,
});

// render the compact time column
const renderTime = (timing: ProjectedTiming, time: DateTime): HTMLElement =>
  render(
    <Time
      context="day"
      hasDeparted={false}
      isExpanded={false}
      isNext
      rowState="normal"
      time={time}
      timing={timing}
    />
  );

describe("schedule departure labels", () => {
  // relative countdown meaning
  it("labels the compact countdown as departure time without claiming a wait", () => {
    const container = renderTime(
      createTiming(),
      scheduledTime.minus({ minutes: 17 })
    );

    expect(container.textContent).toContain("Departs in");
    expect(container.textContent).toContain("17mins");
    expect(container.textContent).not.toMatch(/\bwait\b/i);
  });

  // cancelled time meaning
  it("keeps cancelled sailings on their scheduled clock time", () => {
    const container = renderTime(
      createTiming(true),
      scheduledTime.minus({ minutes: 17 })
    );

    expect(container.textContent).toContain("6:00");
    expect(container.textContent).toContain("PM");
    expect(container.textContent).not.toContain("Departs in");
  });

  // scheduled row names
  it("gives each row its scheduled Pacific departure time", () => {
    const firstTime = DateTime.fromISO("2026-06-21T18:00:00", {
      zone: "America/Los_Angeles",
    });
    const secondTime = firstTime.plus({ minutes: 45 });
    const baseSlot = createForecastSlot({
      fullRisk: "unlikely",
      spacesLeft: 15,
    });
    const firstSlot: Slot = {
      ...baseSlot,
      time: firstTime.toSeconds(),
      wuid: "first-departure",
    };
    const secondSlot: Slot = {
      ...baseSlot,
      time: secondTime.toSeconds(),
      wuid: "second-departure",
    };
    const schedule = [firstSlot, secondSlot];
    const currentTime = firstTime.minus({ hours: 2 });
    const container = render(
      <MemoryRouter>
        <ul>
          {/* sailing rows */}
          {schedule.map((slot) => (
            <SlotInfo
              isExpanded={false}
              key={slot.wuid}
              location={{ address: {}, latitude: 47.98, longitude: -122.35 }}
              onClick={vi.fn()}
              schedule={schedule}
              setElement={vi.fn()}
              slot={slot}
              terminalId="5"
              time={currentTime}
            />
          ))}
        </ul>
      </MemoryRouter>
    );
    // accessible row names
    const rowNames = Array.from(
      container.querySelectorAll<HTMLElement>('section[role="button"]')
    ).map((row) => row.getAttribute("aria-label"));

    expect(rowNames).toEqual([
      `${firstTime.toLocaleString(DateTime.DATETIME_SHORT)} sailing`,
      `${secondTime.toLocaleString(DateTime.DATETIME_SHORT)} sailing`,
    ]);
    expect(new Set(rowNames).size).toBe(2);
  });

  // compact confirmed facts
  it("keeps only scheduled time, confirmed delay, and confirmed fullness in compact rows", () => {
    const slot: Slot = {
      ...createForecastSlot({
        fullRisk: "high",
        spacesLeft: 1,
        withLiveCapacity: true,
      }),
      crossing: {
        ...createForecastSlot({
          fullRisk: "high",
          spacesLeft: 1,
          withLiveCapacity: true,
        }).crossing!,
        departureDelta: 300,
        driveUpCapacity: 25,
        totalCapacity: 100,
      },
      hasPassed: true,
      time: scheduledTime.toSeconds(),
    };
    const container = render(
      <MemoryRouter>
        <ul>
          <SlotInfo
            compact
            isExpanded={false}
            location={{ address: {}, latitude: 47.98, longitude: -122.35 }}
            onClick={vi.fn()}
            schedule={[slot]}
            setElement={vi.fn()}
            slot={slot}
            terminalId="5"
            time={scheduledTime.plus({ minutes: 30 })}
          />
        </ul>
      </MemoryRouter>
    );

    expect(container.textContent).toContain("6:00 PM");
    expect(container.textContent).toContain("5 min late");
    expect(container.textContent).not.toContain("Test Vessel");
    expect(
      container.querySelector<HTMLElement>("[data-confirmed-capacity-fill]")
        ?.style.width
    ).toBe("75%");
    expect(
      container.querySelector('[aria-label="Confirmed capacity: 75% full"]')
    ).not.toBeNull();
  });
});
