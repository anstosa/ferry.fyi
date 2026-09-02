// @vitest-environment jsdom

import { DateTime } from "luxon";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const freshnessPill = vi.hoisted(() => vi.fn(() => null));
const scrollIntoView = vi.hoisted(() => vi.fn());
const queryState = vi.hoisted(() => ({
  query: {} as Record<string, string>,
}));
const adSlot = vi.hoisted(
  (): {
    onReadyChange?: (ready: boolean) => void;
    ready: boolean;
  } => ({ ready: false })
);
const terminalState = vi.hoisted(() => ({
  terminals: [
    {
      id: "5",
      location: { latitude: 47.98, longitude: -122.35 },
    },
  ],
}));
const userState = vi.hoisted(() => ({ isUserLoading: false }));

vi.mock("~/lib/browser", () => ({ useQuery: () => queryState.query }));
vi.mock("~/lib/terminals", () => ({
  useTerminals: () => terminalState,
}));
vi.mock("~/lib/user", () => ({ useUser: () => [userState] }));
vi.mock("scroll-into-view", () => ({ default: scrollIntoView }));
vi.mock("~/components/AdSlot", async () => {
  const { useEffect } = await import("react");
  return {
    AdSlot: ({
      onReadyChange,
    }: {
      onReadyChange?: (ready: boolean) => void;
    }) => {
      // expose placement settlement to the test
      useEffect(() => {
        adSlot.onReadyChange = onReadyChange;
        onReadyChange?.(adSlot.ready);
      }, [onReadyChange]);
      return React.createElement("div", { "data-testid": "schedule-ad" });
    },
  };
});
vi.mock("~/components/FreshnessPill", () => ({
  FreshnessPill: freshnessPill,
}));
vi.mock("~/components/Prompt", () => ({ Prompt: () => null }));
vi.mock("~/components/Toast", () => ({
  Toast: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/static/images/icons/solid/island-tropical.svg", () => ({
  default: () => null,
}));
vi.mock("../../client/views/Schedule/SlotInfo", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    SlotInfo: ({
      setElement,
      slot,
    }: {
      setElement: (element: HTMLDivElement) => void;
      slot: { time: number };
    }) => {
      const element = useRef<HTMLDivElement>(null);
      // register the row anchor after mount
      useEffect(() => {
        if (element.current) {
          setElement(element.current);
        }
      }, []);
      return React.createElement("div", {
        "data-slot-time": slot.time,
        ref: element,
      });
    },
  };
});

import { Schedule } from "../../client/views/Schedule";

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  adSlot.onReadyChange = undefined;
  adSlot.ready = false;
  queryState.query = {};
  userState.isUserLoading = false;
  vi.clearAllMocks();
});

const render = (props: Partial<React.ComponentProps<typeof Schedule>>) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      React.createElement(Schedule, {
        schedule: null,
        time: {} as never,
        ...props,
      })
    );
  });
  return container;
};

// build a schedule with an ad before the next sailing
const getActiveSchedule = (key = "5-14-2026-08-26") => {
  const firstTime = 1_777_777_700;
  return {
    date: "2026-08-26",
    key,
    mateId: "14",
    slots: [
      {
        hasPassed: true,
        mateId: "14",
        time: firstTime,
        vessel: { vehicleCapacity: 144 },
        wuid: `${key}-past`,
      },
      {
        hasPassed: false,
        mateId: "14",
        time: firstTime + 600,
        vessel: { vehicleCapacity: 144 },
        wuid: `${key}-next`,
      },
    ],
    terminalId: "5",
    validRange: null,
  } as never;
};

describe("Schedule load states", () => {
  it("shows the separate schedule check time", () => {
    const schedule = {
      date: "2026-08-02",
      slots: [],
      sourceUpdatedAt: 1,
    } as never;

    render({
      checkedAt: 2_000_000_000,
      onRefresh: vi.fn(),
      schedule,
    });

    expect(freshnessPill.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        sourceUpdatedAt: 2_000_000_000,
      })
    );
  });

  it("hides the check-time pill when no check time is available", () => {
    const schedule = {
      date: "2026-08-02",
      slots: [],
      sourceUpdatedAt: 1,
    } as never;

    render({ checkedAt: null, onRefresh: vi.fn(), schedule });

    expect(freshnessPill).not.toHaveBeenCalled();
  });

  it("shows the schedule error instead of the initial loading state", () => {
    const container = render({ loadError: new Error("offline") });

    expect(container.textContent).toContain("Schedule could not load");
    expect(container.textContent).toContain("offline");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("shows a loading skeleton before any schedule data arrives", () => {
    const container = render({});

    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-label")
    ).toBe("Loading schedule");
  });

  it("keeps schedule content visible when a refresh fails", () => {
    const schedule = { date: "2026-07-27", slots: [] } as never;
    const container = render({ loadError: new Error("offline"), schedule });

    expect(container.textContent).toContain("No sailings scheduled");
    expect(container.textContent).toContain(
      "Could not refresh the schedule. Showing saved data."
    );
    expect(container.textContent).not.toContain("Schedule could not load");
  });
});

describe("Schedule initial scroll", () => {
  // prefer the selected sailing
  it("scrolls to a deep-linked sailing instead of the now row", () => {
    const schedule = getActiveSchedule();
    queryState.query = {
      sailing: String(schedule.slots[0].time),
      tab: "vessel",
    };

    render({
      schedule,
      time: DateTime.fromSeconds(1_777_777_800),
    });

    const target = scrollIntoView.mock.calls[0]?.[0] as HTMLElement;
    expect(target.dataset.slotTime).toBe(String(schedule.slots[0].time));
  });

  // wait for all layout-affecting requests
  it("waits for entitlement and ad settlement before scrolling", async () => {
    userState.isUserLoading = true;
    const schedule = getActiveSchedule();

    render({
      arrivalTerminalId: "14",
      departureTerminalId: "5",
      schedule,
      time: DateTime.fromSeconds(1_777_777_800),
    });

    expect(scrollIntoView).not.toHaveBeenCalled();
    await act(async () => {
      adSlot.onReadyChange?.(true);
    });
    expect(scrollIntoView).not.toHaveBeenCalled();

    userState.isUserLoading = false;
    await act(async () => {
      root?.render(
        React.createElement(Schedule, {
          arrivalTerminalId: "14",
          departureTerminalId: "5",
          schedule,
          time: DateTime.fromSeconds(1_777_777_800),
        })
      );
    });

    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  // avoid refresh-driven jump backs
  it("scrolls only once for repeated updates to one schedule", async () => {
    const schedule = getActiveSchedule();
    render({
      arrivalTerminalId: "14",
      departureTerminalId: "5",
      schedule,
      time: DateTime.fromSeconds(1_777_777_800),
    });

    await act(async () => {
      adSlot.onReadyChange?.(true);
    });
    expect(scrollIntoView).toHaveBeenCalledOnce();

    await act(async () => {
      root?.render(
        React.createElement(Schedule, {
          arrivalTerminalId: "14",
          departureTerminalId: "5",
          schedule: { ...schedule, sourceUpdatedAt: 123 } as never,
          time: DateTime.fromSeconds(1_777_777_800),
        })
      );
    });

    expect(scrollIntoView).toHaveBeenCalledOnce();
  });
});
