// @vitest-environment jsdom

import { DateTime } from "luxon";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Terminal } from "../../shared/contracts/terminals";
import { getRecommendationServiceDate } from "../../shared/lib/sailingRecommendationRevision";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const useful = vi.hoisted(() => ({ hook: vi.fn(), ref: vi.fn() }));
vi.mock("~/lib/usefulVisits", () => ({
  // capture readiness and the actual meaningful schedule node
  useUsefulContent: (...args: unknown[]) => {
    useful.hook(...args);
    return useful.ref;
  },
}));
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
      compact,
      getSailingShareUrl,
      initialDetailTab,
      isExpanded,
      onClick,
      setElement,
      slot,
    }: {
      compact?: boolean;
      getSailingShareUrl: (tab: "vessel") => string;
      initialDetailTab?: string;
      isExpanded: boolean;
      onClick: () => void;
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
        "data-compact": String(Boolean(compact)),
        "data-expanded": String(isExpanded),
        "data-initial-detail-tab": initialDetailTab,
        "data-share-url": getSailingShareUrl("vessel"),
        "data-slot-time": slot.time,
        onClick,
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

// build the route context required by the browser schedule overview
const getOverviewTerminals = (): {
  arrivalTerminal: Terminal;
  departureTerminal: Terminal;
} => {
  const departureTerminal: Terminal = {
    abbreviation: "CLI",
    bulletins: [],
    cameras: [],
    hasElevator: false,
    hasFood: false,
    hasOverheadLoading: false,
    hasRestroom: true,
    hasWaitingRoom: true,
    id: "5",
    info: {},
    location: { address: {}, latitude: 47.98, longitude: -122.35 },
    mates: [],
    name: "Clinton",
    popularity: 1,
    waitTimes: [],
  };
  const arrivalTerminal = {
    ...departureTerminal,
    id: "14",
    name: "Mukilteo",
  };
  departureTerminal.mates = [arrivalTerminal];
  return { arrivalTerminal, departureTerminal };
};

describe("Schedule load states", () => {
  // placeholders and empty schedules cannot start useful exposure
  it("wires only usable sailings as useful content", () => {
    render({ schedule: null });
    expect(useful.hook).toHaveBeenLastCalledWith("schedule", "", false);
    act(() => root?.unmount());
    root = undefined;
    render({ schedule: { key: "empty", slots: [] } as never });
    expect(useful.hook).toHaveBeenLastCalledWith("schedule", "empty", false);
    act(() => root?.unmount());
    root = undefined;
    const container = render({
      schedule: getActiveSchedule(),
      time: DateTime.fromSeconds(1_777_777_800),
    });
    expect(useful.hook).toHaveBeenLastCalledWith(
      "schedule",
      "5-14-2026-08-26",
      true
    );
    expect(useful.ref).toHaveBeenCalledWith(
      container.querySelector('[data-slot-time="1777778300"]')?.closest("ul")
    );
  });

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

  // floating freshness must not extend the sailing list's scroll boundary
  it("keeps freshness out of layout while retaining the refresh action", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const container = render({
      checkedAt: 2_000_000_000,
      onRefresh,
      schedule: getActiveSchedule(),
      time: DateTime.fromSeconds(1_777_777_800),
    });
    const overlay = container.querySelector("main")?.lastElementChild;
    expect(overlay?.classList.contains("h-0")).toBe(true);
    expect(overlay?.classList.contains("shrink-0")).toBe(true);
    expect(overlay?.className).not.toMatch(/(?:^|\s)(?:mt-|pb-)/);
    const pill = freshnessPill.mock.calls.at(-1)?.[0] as {
      className: string;
      onClick: () => void;
    };
    expect(pill.className).toContain("absolute");
    expect(pill.className).toContain("bottom-1");
    await act(async () => {
      pill.onClick();
      await Promise.resolve();
    });
    expect(onRefresh).toHaveBeenCalledOnce();
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
  // recovery and empty states retain the wait answer and departures heading
  it.each(["loading", "failed", "empty"])(
    "keeps the overview and departures target when the schedule is %s",
    (state) => {
      const terminal = {
        abbreviation: "CLI",
        bulletins: [],
        id: "5",
        mates: [{ id: "14" }],
        name: "Clinton",
        waitTimes: [],
      } as unknown as Terminal;
      const mate = {
        ...terminal,
        abbreviation: "MUK",
        id: "14",
        name: "Mukilteo",
      };
      const now = DateTime.fromSeconds(1_777_777_800);
      const selectedDate = getRecommendationServiceDate(now.toSeconds());
      const container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      // exercise the real shared overview while changing only schedule readiness
      act(() => {
        root?.render(
          React.createElement(
            MemoryRouter,
            null,
            React.createElement(Schedule, {
              arrivalTerminal: mate,
              departureTerminal: terminal,
              loadError: state === "failed" ? new Error("offline") : undefined,
              schedule:
                state === "empty"
                  ? ({
                      ...getActiveSchedule(),
                      date: selectedDate,
                      slots: [],
                    } as never)
                  : null,
              selectedDate,
              time: now,
            })
          )
        );
      });
      expect(container.querySelector("h1")?.textContent).toContain(
        "Clinton to Mukilteo"
      );
      expect(container.textContent).toContain("None reported");
      expect(container.querySelector('a[href="#departures"]')).toBeNull();
      expect(container.querySelector("#departures")).not.toBeNull();
      expect(container.querySelector("h2#departures")).toBeNull();
      expect(container.textContent).not.toContain(
        "Sailings for this service date"
      );
    }
  );

  // past sailings stay compact above the live schedule while retaining row actions
  it("does not auto-scroll past the wait overview and retains past sailings", () => {
    const { arrivalTerminal, departureTerminal } = getOverviewTerminals();
    const now = DateTime.fromSeconds(1_777_777_800);
    const selectedDate = getRecommendationServiceDate(now.toSeconds());
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // mount the real route-link context used by the new summary
    act(() => {
      root?.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(Schedule, {
            arrivalTerminal,
            departureTerminal,
            schedule: { ...getActiveSchedule(), date: selectedDate } as never,
            selectedDate,
            time: now,
          })
        )
      );
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(container.querySelector("h1")?.textContent).toContain(
      "Clinton to Mukilteo"
    );
    const past = container.querySelector<HTMLElement>("[data-past-sailings]");
    const pastRow = past?.querySelector<HTMLElement>(
      '[data-slot-time="1777777700"]'
    );
    const upcomingRow = container.querySelector<HTMLElement>(
      '[data-slot-time="1777778300"]'
    );
    expect(past?.tagName).toBe("DIV");
    expect(past?.querySelector("[data-older-sailings]")).toBeNull();
    expect(pastRow).not.toBeNull();
    expect(pastRow?.dataset.compact).toBe("true");
    expect(upcomingRow).not.toBeNull();
    expect(upcomingRow?.dataset.compact).toBe("false");
    expect(
      (past as Node).compareDocumentPosition(upcomingRow as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(pastRow?.closest("details")).toBeNull();
    act(() => pastRow?.click());
    expect(pastRow?.dataset.expanded).toBe("true");
    const shareUrl = new URL(pastRow?.dataset.shareUrl ?? "");
    expect(shareUrl.searchParams.get("date")).toBe(selectedDate);
    expect(shareUrl.searchParams.get("sailing")).toBe("1777777700");
    expect(shareUrl.searchParams.get("tab")).toBe("vessel");
  });

  // recent past deep links expand their already visible row
  it("opens and scrolls to a deep-linked past sailing", () => {
    const schedule = getActiveSchedule();
    const { arrivalTerminal, departureTerminal } = getOverviewTerminals();
    const now = DateTime.fromSeconds(1_777_777_800);
    const selectedDate = getRecommendationServiceDate(now.toSeconds());
    queryState.query = {
      sailing: String(schedule.slots[0].time),
      tab: "vessel",
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // mount the real overview link context around the deep-linked schedule
    act(() => {
      root?.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(Schedule, {
            arrivalTerminal,
            departureTerminal,
            schedule: { ...schedule, date: selectedDate } as never,
            selectedDate,
            time: now,
          })
        )
      );
    });

    const target = scrollIntoView.mock.calls[0]?.[0] as HTMLElement;
    expect(target.dataset.slotTime).toBe(String(schedule.slots[0].time));
    expect(target.dataset.compact).toBe("true");
    expect(target.dataset.expanded).toBe("true");
    expect(target.dataset.initialDetailTab).toBe("vessel");
    expect(target.closest("[data-recent-sailings]")).not.toBeNull();
    expect(target.closest("details")).toBeNull();
  });

  // only older history needs a disclosure and ads precede the entire group
  it.each([false, true])(
    "shows four recent sailings and preserves older deep links: %s",
    (linkedOlder) => {
      const base = getActiveSchedule();
      const now = DateTime.fromSeconds(1_777_777_800);
      const selectedDate = getRecommendationServiceDate(now.toSeconds());
      // keep six completed rows and the next departure in chronological order
      const pastSlots = [1500, 1200, 900, 600, 300, 0].map((offset) => ({
        ...base.slots[0],
        time: base.slots[0].time - offset,
        wuid: `past-${offset}`,
      }));
      const schedule = {
        ...base,
        date: selectedDate,
        slots: [...pastSlots, base.slots[1]],
      };
      const { arrivalTerminal, departureTerminal } = getOverviewTerminals();
      adSlot.ready = true;
      // an older deep link must open only the older disclosure
      if (linkedOlder) {
        queryState.query = {
          sailing: String(pastSlots[0].time),
          tab: "vessel",
        };
      }
      const container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      act(() => {
        root?.render(
          React.createElement(
            MemoryRouter,
            null,
            React.createElement(Schedule, {
              arrivalTerminal,
              arrivalTerminalId: "14",
              departureTerminal,
              departureTerminalId: "5",
              schedule,
              selectedDate,
              time: now,
            })
          )
        );
      });
      const recent = container.querySelector("[data-recent-sailings]")!;
      expect(
        [...recent.querySelectorAll<HTMLElement>("[data-slot-time]")].map(
          (row) => Number(row.dataset.slotTime)
        )
      ).toEqual(pastSlots.slice(-4).map((slot) => slot.time));
      expect(recent.closest("details")).toBeNull();
      const older = container.querySelector<HTMLDetailsElement>(
        "details[data-older-sailings]"
      )!;
      expect(older.querySelector("summary")?.textContent?.trim()).toBe(
        "Earlier sailings (2)"
      );
      expect(older.querySelectorAll("[data-slot-time]")).toHaveLength(2);
      expect(older.open).toBe(linkedOlder);
      const ad = container.querySelector('[data-testid="schedule-ad"]')!;
      const history = container.querySelector("[data-past-sailings]")!;
      expect(
        ad.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        container.querySelectorAll('[data-testid="schedule-ad"]')
      ).toHaveLength(1);
      expect(
        recent.compareDocumentPosition(
          container.querySelector('[aria-label="Current time"]')!
        ) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      // preserve expansion and scrolling when the target is outside the visible four
      if (linkedOlder) {
        const target = scrollIntoView.mock.calls[0]?.[0] as HTMLElement;
        expect(target.dataset.slotTime).toBe(String(pastSlots[0].time));
        expect(target.dataset.expanded).toBe("true");
      }
    }
  );

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
