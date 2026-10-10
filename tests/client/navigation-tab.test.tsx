// @vitest-environment jsdom
import { DateTime } from "luxon";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { Schedule } from "shared/contracts/schedules";
import type { Terminal } from "shared/contracts/terminals";
import { unavailableRecommendation } from "shared/lib/sailingRecommendationResponse";
import { getRecommendationServiceDate } from "shared/lib/sailingRecommendationRevision";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adapters = vi.hoisted(() => ({ post: vi.fn(), location: vi.fn() }));
// isolate explicit trip requests from native networking
vi.mock("~/lib/api", () => ({
  post: adapters.post,
  ApiError: class extends Error {},
}));
// never acquire a location as part of mounting or switching tabs
vi.mock("~/lib/geo", () => ({
  requestForegroundLocation: adapters.location,
}));
// expose the header position without loading private banner effects
vi.mock("~/views/Header", () => ({
  // render the fixture header in document order
  Header: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
}));
// keep route selection deterministic in this presentation fixture
vi.mock("~/components/RouteSelector", () => ({
  // identify the selected direction without terminal network calls
  RouteSelector: () => <span>Seattle to Bainbridge</span>,
}));
// isolate contextual ads from explicit trip requests
vi.mock("~/components/AdSlot", () => ({
  // expose terminal targeting without issuing an exposure
  AdSlot: ({
    arrivalTerminalId,
    departureTerminalId,
    slot,
  }: {
    arrivalTerminalId?: string;
    departureTerminalId?: string;
    slot: string;
  }) => (
    <div
      data-ad-arrival={arrivalTerminalId}
      data-ad-departure={departureTerminalId}
      data-ad-slot={slot}
    />
  ),
}));

import { Footer } from "../../client/components/Footer";
import { Navigation } from "../../client/views/Navigation";
import { NowDivider } from "../../client/views/Schedule/NowDividerView";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const NOW = 1_800_000_000;
const PATH = "/seattle/bainbridge";
const terminal = {
  id: "7",
  name: "Seattle",
  mates: [],
  bulletins: [
    {
      date: NOW,
      bodyText: "A test service notice",
      title: "Test notice",
      level: "info",
    },
  ],
} as unknown as Terminal;
const mate = { id: "3", name: "Bainbridge" } as Terminal;
const schedule = {
  date: getRecommendationServiceDate(NOW),
  key: "7-3-navigation-test",
  terminalId: "7",
  mateId: "3",
  slots: [],
  validRange: null,
} as Schedule;
let root: Root;
let container: HTMLDivElement;
const onCurrentDay = vi.fn();
const onRefresh = vi.fn<() => Promise<Schedule | null>>();
const onReload = vi.fn();

// preserve the selected directional URL for every footer item
const getPath: React.ComponentProps<typeof Footer>["getPath"] = (input) =>
  input?.view === "schedule" ? PATH : `${PATH}/${input?.view}`;

// supply only the route state needed by the navigation page
const navigation = (
  overrides: Partial<React.ComponentProps<typeof Navigation>> = {}
) => (
  <Navigation
    checkedAt={null}
    isCurrentServiceDay
    isRefreshing={false}
    loadError={null}
    mate={mate}
    onGoToCurrentDay={onCurrentDay}
    onRefresh={onRefresh}
    onReload={onReload}
    schedule={schedule}
    setRoute={vi.fn()}
    terminal={terminal}
    {...overrides}
  />
);

// switch between the current-time schedule entry and the full navigation form
const TabHarness = (): React.ReactElement => {
  const location = useLocation();
  return (
    <>
      {location.pathname.endsWith("/navigation") ? (
        navigation()
      ) : (
        <>
          <header>Schedule header</header>
          <main>
            <ul>
              <NowDivider time={DateTime.fromSeconds(NOW)} />
            </ul>
          </main>
        </>
      )}
      <Footer terminal={terminal} getPath={getPath} />
    </>
  );
};

// mount one isolated presentation with controllable route state
const render = async (
  element: React.ReactElement,
  path = PATH
): Promise<void> => {
  await act(() => {
    root.render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>);
  });
};

// reset the clock and every explicit request adapter
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(DateTime.fromSeconds(NOW).toJSDate());
  vi.resetAllMocks();
  onRefresh.mockResolvedValue(schedule);
  window.localStorage.clear();
  // isolate saved trip parameters and private address fragments between cases
  window.history.replaceState(null, "", PATH);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

// release transient form state and fixture timers
afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

// keep route navigation separate from paid directions and foreground location
describe("navigation trip tab", () => {
  // the visible trip prompt is the page title across loading and dated recovery states
  it.each(["loaded", "loading", "dated"])(
    "uses one normalized page title while %s",
    async (state) => {
      await render(
        navigation({
          isCurrentServiceDay: state !== "dated",
          schedule: state === "loading" ? null : schedule,
        })
      );
      const titles = container.querySelectorAll("h1");

      expect(titles).toHaveLength(1);
      expect(titles[0]?.textContent).toBe("What boat will I make?");
      expect(titles[0]?.className).toBe(
        "text-xl font-bold leading-tight sm:text-2xl text-black dark:text-white"
      );
      expect(titles[0]?.previousElementSibling).toBeNull();
      expect(titles[0]?.closest("main")).not.toBeNull();
      // all navigation states share the other pages' title width and inset
      expect(titles[0]?.closest("[data-route-page-intro]")).not.toBeNull();
      expect(titles[0]?.closest(".max-w-2xl")).toBeNull();
      const page = titles[0]?.closest(".max-w-6xl");
      expect(page?.classList).toContain("p-4");
      expect(page?.classList).not.toContain("py-2");
      // retain the centered trip layout below the full-width introduction
      if (state !== "dated") {
        const body = page?.querySelector(".max-w-2xl");
        expect(body?.classList).toContain("mx-auto");
      }
    }
  );

  // keep one terminal-scoped placement between controls and trip results
  it.each([true, false])(
    "keeps the navigation planning links above the form while loading: %s",
    async (loading) => {
      await render(navigation({ schedule: loading ? null : schedule }));
      const links = [
        ...container.querySelectorAll(
          'nav[aria-label="Navigation planning links"] a'
        ),
      ];
      expect(links.map((link) => link.textContent)).toEqual([
        "Schedule & wait",
        "Ferry line cameras",
        "Terminal info",
        "Route Map",
        "How much does it cost?",
        "WSF Alerts",
      ]);
      expect(links[0]?.getAttribute("href")).toBe(PATH);
      expect(links[0]?.closest('[aria-busy="true"]')).toBeNull();
      // animate estimate jumps without overriding reduced-motion preferences
      expect(container.querySelector("main")?.classList).toContain(
        "motion-safe:scroll-smooth"
      );
      const form = container.querySelector(
        loading ? "[data-navigation-form-loading]" : "form"
      );
      expect(links[0]?.compareDocumentPosition(form!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      );
      expect(adapters.post).not.toHaveBeenCalled();
      expect(adapters.location).not.toHaveBeenCalled();
    }
  );

  // preserve the placement after the complete form and before explicit trip results
  it("renders one navigation ad after the form and before results without targeting its origin", async () => {
    await render(navigation());
    const ad = container.querySelector('[data-ad-slot="navigation"]');
    const form = container.querySelector("form");

    expect(
      container.querySelectorAll('[data-ad-slot="navigation"]')
    ).toHaveLength(1);
    expect(ad?.getAttribute("data-ad-departure")).toBe("7");
    expect(ad?.hasAttribute("data-ad-arrival")).toBe(false);
    expect(form).not.toBeNull();
    expect(form?.compareDocumentPosition(ad!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(form?.nextElementSibling).toBe(ad);
    expect(
      ad?.compareDocumentPosition(
        container.querySelector('[aria-live="polite"][aria-busy]')!
      )
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(adapters.post).not.toHaveBeenCalled();
    expect(adapters.location).not.toHaveBeenCalled();
  });

  // preserve ad identity and order while a foreground estimate resolves
  it("keeps the same ad above loading and completed estimate feedback", async () => {
    let resolveRecommendation:
      | ((response: ReturnType<typeof unavailableRecommendation>) => void)
      | undefined;
    adapters.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRecommendation = resolve;
        })
    );
    adapters.location.mockResolvedValue({
      latitude: 47.602,
      longitude: -122.338,
    });
    await render(navigation());
    const ad = container.querySelector('[data-ad-slot="navigation"]');
    const button = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent === "Use my location"
    );
    await act(() => {
      button?.click();
    });
    const results = container.querySelector('[aria-live="polite"][aria-busy]');

    expect(results?.getAttribute("aria-busy")).toBe("true");
    expect(
      results?.querySelector('[aria-label="Estimating your trip"]')
    ).not.toBeNull();
    expect(ad?.compareDocumentPosition(results!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(container.querySelector('[data-ad-slot="navigation"]')).toBe(ad);
    await act(() => {
      resolveRecommendation?.(
        unavailableRecommendation("drive", "configuration-unavailable", NOW)
      );
    });
    expect(results?.getAttribute("aria-busy")).toBe("false");
    expect(results?.textContent).toContain(
      "Travel estimates are not enabled yet."
    );
    expect(
      container.querySelectorAll('[data-ad-slot="navigation"]')
    ).toHaveLength(1);
    expect(container.querySelector('[data-ad-slot="navigation"]')).toBe(ad);
    expect(ad?.compareDocumentPosition(results!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  // share a placement across destinations but keep departure terminals distinct
  it("updates ad targeting only when the departure terminal changes", async () => {
    await render(navigation());
    await render(navigation({ mate: { ...mate, id: "10" } }));
    expect(
      container
        .querySelector('[data-ad-slot="navigation"]')
        ?.getAttribute("data-ad-departure")
    ).toBe("7");
    await render(navigation({ terminal: mate, mate: terminal }));
    expect(
      container
        .querySelector('[data-ad-slot="navigation"]')
        ?.getAttribute("data-ad-departure")
    ).toBe("3");
    expect(adapters.post).not.toHaveBeenCalled();
    expect(adapters.location).not.toHaveBeenCalled();
  });

  // keep the header focused on the selected direction and the icon in the footer
  it("removes the navigation icon from the header but keeps the footer tab", async () => {
    await render(<TabHarness />, `${PATH}/navigation`);
    expect(container.querySelector("header svg")).toBeNull();
    expect(container.querySelector("header")?.textContent).toContain(
      "Seattle to Bainbridge"
    );
    expect(
      container.querySelector('footer [aria-label="Navigation"] svg')
    ).not.toBeNull();
  });

  // keep the current-time divider compact without duplicating navigation
  it("renders one Now row without a trip-planning prompt", async () => {
    await render(<TabHarness />);
    const banner = container.querySelector('[aria-label="Current time"]');
    expect(banner?.querySelector("a")).toBeNull();
    expect(banner?.children).toHaveLength(1);
    expect(banner?.firstElementChild?.textContent).toBe(
      `Now${DateTime.fromSeconds(NOW).setZone("America/Los_Angeles").toFormat("h:mm a")}`
    );
    expect(banner?.textContent).not.toContain("What boat will I make?");
    expect(container.querySelector("main")?.contains(banner)).toBe(true);
    expect(container.querySelector("header")?.nextElementSibling?.tagName).toBe(
      "MAIN"
    );
    expect(
      container.querySelector('[aria-label="Starting address"]')
    ).toBeNull();
    expect(adapters.post).not.toHaveBeenCalled();
    expect(adapters.location).not.toHaveBeenCalled();
  });

  // keep the visible clock synchronized with the schedule's current time
  it("updates the Pacific clock without requesting directions", async () => {
    const time = DateTime.fromISO("2026-10-03T17:04:00Z");
    await render(
      <ul>
        <NowDivider time={time} />
      </ul>
    );
    expect(container.querySelector("time")?.textContent).toBe("10:04 AM");
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
      time.toISO()
    );
    await render(
      <ul>
        <NowDivider time={time.plus({ minutes: 1 })} />
      </ul>
    );
    expect(container.querySelector("time")?.textContent).toBe("10:05 AM");
    expect(adapters.post).not.toHaveBeenCalled();
    expect(adapters.location).not.toHaveBeenCalled();
  });

  // omit leave-now entry for a non-current service day
  it("does not offer a trip prompt without a current-day navigation path", async () => {
    await render(
      <ul>
        <NowDivider time={DateTime.fromSeconds(NOW)} />
      </ul>
    );
    expect(container.querySelector("time")).not.toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).not.toContain("What boat will I make?");
  });

  // keep a separate navigation arrow in the bottom route bar
  it("keeps all existing footer tabs and exposes the navigation icon", async () => {
    await render(
      <Footer terminal={terminal} getPath={getPath} />,
      `${PATH}/navigation`
    );
    const links = Array.from(container.querySelectorAll("footer nav a"));
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Schedule",
      "Navigation",
      "Cameras",
      "Terminal details",
      "Map",
      "Fares",
      "Alerts and bulletins",
    ]);
    expect(
      container.querySelector('[aria-label="Navigation"] svg')
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Map"] svg')?.getAttribute("viewBox")
    ).toBe("0 0 576 512");
    expect(
      container.querySelector('[aria-label="Navigation"]')?.getAttribute("href")
    ).toBe(`${PATH}/navigation`);
  });

  // cached promotions must not create or timestamp a footer alert
  it("ignores opinion-group bulletins in the footer summary", async () => {
    const promotion = {
      ...terminal.bulletins[0],
      date: NOW - 60,
      title: "Join the Ferry Riders Opinion Group",
    };
    await render(
      <Footer
        terminal={{ ...terminal, bulletins: [promotion] }}
        getPath={getPath}
      />
    );
    expect(
      container.querySelector('[aria-label="Alerts and bulletins"]')
    ).toBeNull();

    await render(
      <Footer
        terminal={{
          ...terminal,
          bulletins: [
            promotion,
            { ...terminal.bulletins[0], date: NOW - 1200 },
          ],
        }}
        getPath={getPath}
      />
    );
    expect(
      container.querySelector('[aria-label="Alerts and bulletins"]')
        ?.textContent
    ).toContain("20 mins ago");
    expect(container.textContent).not.toContain("1 min ago");
  });

  // require the correct ferry service day before showing the origin form
  it("offers current-day recovery instead of a dated estimate", async () => {
    await render(navigation({ isCurrentServiceDay: false }));
    expect(
      container.querySelectorAll('[data-ad-slot="navigation"]')
    ).toHaveLength(1);
    expect(container.textContent).toContain(
      "Leave-now estimates use the current ferry day."
    );
    expect(
      container.querySelector('[aria-label="Starting address"]')
    ).toBeNull();
    const button = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent === "Use current ferry day"
    );
    await act(() => button?.click());
    expect(onCurrentDay).toHaveBeenCalledTimes(1);
    expect(adapters.post).not.toHaveBeenCalled();
  });

  // keep known page copy visible while schedule-dependent controls load
  it("shows form skeletons until the schedule loads and preserves saved controls", async () => {
    window.history.replaceState(
      null,
      "",
      `${PATH}/navigation?tripMode=walk&tripBuffer=9#tripAddress=Saved+while+loading`
    );
    await render(navigation({ schedule: null }));
    const loader = container.querySelector('[aria-label="Loading navigation"]');
    expect(loader).not.toBeNull();
    expect(loader?.getAttribute("aria-busy")).toBe("true");
    expect(loader?.querySelectorAll(".skeleton")).toHaveLength(8);
    expect(container.textContent).toContain("What boat will I make?");
    expect(
      container.querySelector("h1")?.closest('[aria-busy="true"]')
    ).toBeNull();
    expect(container.querySelector("input, form")).toBeNull();
    expect(
      container.querySelector("[data-sailing-estimate-placeholder]")
    ).toBeNull();
    const ad = container.querySelector('[data-ad-slot="navigation"]');
    expect(
      container.querySelectorAll('[data-ad-slot="navigation"]')
    ).toHaveLength(1);
    expect(
      loader!.compareDocumentPosition(ad!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(adapters.post).not.toHaveBeenCalled();
    expect(adapters.location).not.toHaveBeenCalled();

    await render(navigation());
    expect(
      container.querySelector("[data-navigation-form-loading]")
    ).toBeNull();
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Starting address"]'
      )?.value
    ).toBe("Saved while loading");
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Safety buffer (minutes)"]'
      )?.value
    ).toBe("9");
    const walkButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent === "Walk"
    );
    expect(walkButton?.getAttribute("aria-pressed")).toBe("true");
    expect(adapters.post).not.toHaveBeenCalled();
    expect(adapters.location).not.toHaveBeenCalled();
  });

  // cached schedules remain usable during refresh and refresh failure
  it("keeps the loaded form instead of restoring skeletons during refresh", async () => {
    await render(
      navigation({ isRefreshing: true, loadError: new Error("refresh failed") })
    );
    expect(
      container.querySelector("[data-navigation-form-loading]")
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="Starting address"]')
    ).not.toBeNull();
    expect(container.textContent).toContain("Showing saved data");
    expect(adapters.post).not.toHaveBeenCalled();
    expect(adapters.location).not.toHaveBeenCalled();
  });

  // failed initial reads settle to recovery rather than indefinite skeletons
  it("shows sanitized recovery without form skeletons or origin requests", async () => {
    onReload.mockResolvedValue(undefined);
    await render(
      navigation({
        schedule: null,
        loadError: new Error("schedule unavailable"),
      })
    );
    expect(container.textContent).toContain("Navigation could not load");
    expect(container.querySelector(".skeleton, input, form")).toBeNull();
    expect(
      container.querySelectorAll('[data-ad-slot="navigation"]')
    ).toHaveLength(1);
    const button = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent === "Retry schedule"
    );
    await act(() => button?.click());
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(adapters.post).not.toHaveBeenCalled();
    expect(adapters.location).not.toHaveBeenCalled();
  });

  // refresh cached schedule data before every paid location estimate
  it("refreshes the schedule before requesting a location estimate", async () => {
    adapters.location.mockResolvedValue({
      latitude: 47.602,
      longitude: -122.338,
    });
    adapters.post.mockResolvedValue(
      unavailableRecommendation("drive", "configuration-unavailable", NOW)
    );
    await render(navigation());
    expect(onRefresh).not.toHaveBeenCalled();
    expect(adapters.post).not.toHaveBeenCalled();
    const button = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent === "Use my location"
    );
    await act(async () => {
      button?.click();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(adapters.location).toHaveBeenCalledTimes(1);
    expect(adapters.post).toHaveBeenCalledTimes(1);
    expect(onRefresh.mock.invocationCallOrder[0]).toBeLessThan(
      adapters.post.mock.invocationCallOrder[0]
    );
    expect(container.textContent).toContain(
      "Travel estimates are not enabled yet."
    );
  });

  // stop before paid work when fresh schedule data is unavailable
  it("shows a sanitized refresh error when no fresh schedule is available", async () => {
    onRefresh.mockResolvedValue(null);
    adapters.location.mockResolvedValue({
      latitude: 47.602,
      longitude: -122.338,
    });
    await render(navigation());
    const button = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent === "Use my location"
    );
    await act(async () => {
      button?.click();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(adapters.location).toHaveBeenCalledTimes(1);
    expect(adapters.post).not.toHaveBeenCalled();
    expect(
      Array.from(container.querySelectorAll('[role="status"]')).map(
        (status) => status.textContent
      )
    ).toContain("Could not refresh the ferry schedule. Try again.");
    expect(container.textContent).not.toContain("schedule unavailable");
  });

  // keep result feedback in the navigation page after an explicit form submit
  it("displays request results in the tab and clears them on leaving", async () => {
    adapters.post.mockResolvedValue(
      unavailableRecommendation("drive", "configuration-unavailable", NOW)
    );
    await render(<TabHarness />, `${PATH}/navigation`);
    const address = container.querySelector(
      '[aria-label="Starting address"]'
    ) as HTMLInputElement;
    await act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(address, "test origin");
      address.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() =>
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true })
        )
    );
    expect(adapters.post).toHaveBeenCalledTimes(1);
    expect(container.querySelector("main")?.textContent).toContain(
      "Travel estimates are not enabled yet."
    );
    const scheduleLink = container.querySelector(
      '[aria-label="Schedule"]'
    ) as HTMLAnchorElement;
    await act(() => scheduleLink.click());
    expect(
      container.querySelector('[aria-label="Starting address"]')
    ).toBeNull();
    expect(container.textContent).not.toContain(
      "Travel estimates are not enabled yet."
    );
  });
});
