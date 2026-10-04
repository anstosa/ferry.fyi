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
              <NowDivider
                navigationPath={`${PATH}/navigation`}
                time={DateTime.fromSeconds(NOW)}
              />
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

  // place the trip prompt in the second row of the current-time banner
  it("opens the form from the two-row Now banner inside the schedule", async () => {
    await render(<TabHarness />);
    const banner = container.querySelector('[aria-label="Current time"]');
    const prompt = banner?.querySelector(
      'a[href$="/navigation"]'
    ) as HTMLAnchorElement;
    expect(prompt.textContent).toBe("What boat will I make?");
    expect(banner?.children).toHaveLength(2);
    expect(banner?.firstElementChild?.textContent).toBe(
      `Now${DateTime.fromSeconds(NOW).setZone("America/Los_Angeles").toFormat("h:mm a")}`
    );
    expect(banner?.lastElementChild).toBe(prompt);
    expect(container.querySelector("main")?.contains(banner)).toBe(true);
    expect(container.querySelector("header")?.nextElementSibling?.tagName).toBe(
      "MAIN"
    );
    expect(
      container.querySelector('[aria-label="Starting address"]')
    ).toBeNull();
    await act(() => prompt.click());
    expect(
      container.querySelector('[aria-label="Starting address"]')
    ).not.toBeNull();
    expect(
      container
        .querySelector('[aria-label="Navigation"]')
        ?.getAttribute("aria-current")
    ).toBe("page");
    expect(
      (
        container.querySelector(
          '[aria-label="Safety buffer (minutes)"]'
        ) as HTMLInputElement
      ).value
    ).toBe("5");
    expect(adapters.post).not.toHaveBeenCalled();
    expect(adapters.location).not.toHaveBeenCalled();
  });

  // keep the visible clock synchronized with the schedule's current time
  it("updates the Pacific clock without requesting directions", async () => {
    const time = DateTime.fromISO("2026-10-03T17:04:00Z");
    await render(
      <ul>
        <NowDivider navigationPath={`${PATH}/navigation`} time={time} />
      </ul>
    );
    expect(container.querySelector("time")?.textContent).toBe("10:04 AM");
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
      time.toISO()
    );
    await render(
      <ul>
        <NowDivider
          navigationPath={`${PATH}/navigation`}
          time={time.plus({ minutes: 1 })}
        />
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

  // require the correct ferry service day before showing the origin form
  it("offers current-day recovery instead of a dated estimate", async () => {
    await render(navigation({ isCurrentServiceDay: false }));
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

  // retain a retry path when a direct tab load cannot get its schedule
  it("shows loading and sanitized API recovery without requesting an origin", async () => {
    await render(navigation({ schedule: null }));
    expect(
      container.querySelector('[aria-label="Loading navigation"]')
    ).not.toBeNull();
    onReload.mockResolvedValue(undefined);
    await render(
      navigation({
        schedule: null,
        loadError: new Error("schedule unavailable"),
      })
    );
    expect(container.textContent).toContain("Navigation could not load");
    const button = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent === "Reload"
    );
    await act(() => button?.click());
    expect(onReload).toHaveBeenCalledTimes(1);
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
