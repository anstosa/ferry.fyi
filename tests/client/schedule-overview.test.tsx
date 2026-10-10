// @vitest-environment jsdom

import { DateTime } from "luxon";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ScheduleOverview } from "../../client/components/ScheduleOverview";
import { type Bulletin, Level } from "../../shared/contracts/bulletins";
import type { Schedule } from "../../shared/contracts/schedules";
import { createForecastSlot } from "../fixtures/forecastSlot";

type OverviewProps = React.ComponentProps<typeof ScheduleOverview>;
const time = DateTime.fromISO("2026-10-07T12:00:00", {
  zone: "America/Los_Angeles",
});
const terminal: OverviewProps["terminal"] = {
  abbreviation: "SEA",
  bulletins: [],
  id: "7",
  mates: [{ id: "3" }, { id: "4" }],
  name: "Seattle",
  waitTimes: [
    {
      description: "Arrive 30–60 minutes before sailing.",
      time: 0,
      title: "Seattle / Bainbridge",
    },
  ],
};
const mate: OverviewProps["mate"] = {
  ...terminal,
  abbreviation: "BBG",
  id: "3",
  mates: [{ id: "7" }],
  name: "Bainbridge",
};

// construct a real typed sailing with only scenario timing changed
const getSchedule = (date = "2026-10-07"): Schedule => ({
  date,
  key: `7-3-${date}`,
  mateId: "3",
  slots: [
    {
      ...createForecastSlot({ fullRisk: "low", spacesLeft: 50 }),
      time: time.plus({ minutes: 30 }).toSeconds(),
    },
  ],
  sourceUpdatedAt: time.minus({ minutes: 5 }).toSeconds(),
  terminalId: "7",
  validRange: null,
});

// represent source prose without reducing it to an invented queue number
const getAlert = (overrides: Partial<Bulletin> = {}): Bulletin => ({
  bodyHTML: "",
  bodyText: "A 60 Minute Wait is reported at Bainbridge for vehicle traffic.",
  date: time.minus({ minutes: 20 }).toSeconds(),
  level: Level.HIGH,
  routePrefix: "SEA/BBG",
  terminalId: "7",
  title: "Vehicle wait report",
  ...overrides,
});

// inspect semantic initial html without browser or network collaborators
const render = (overrides: Partial<OverviewProps> = {}): HTMLElement => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <MemoryRouter>
      <ScheduleOverview
        mate={mate}
        schedule={getSchedule()}
        selectedDate="2026-10-07"
        terminal={terminal}
        time={time}
        {...overrides}
      />
    </MemoryRouter>
  );
  return container;
};

describe("wait-first schedule overview", () => {
  // retain known route answers while reports and departures remain unresolved
  it("skeletonizes only the loading wait report and departure values", () => {
    const page = render({
      reportsLoading: true,
      schedule: null,
      scheduleLoading: true,
    });
    const busyRegions = Array.from(
      page.querySelectorAll<HTMLElement>('[role="status"][aria-busy="true"]')
    );

    expect(page.querySelector("h1")?.textContent).toContain(
      "Seattle to Bainbridge ferry wait times & schedule"
    );
    expect(page.textContent).toContain("October 7, 2026");
    expect(page.querySelector("#schedule-wait-heading")?.textContent).toBe(
      "Vehicle wait"
    );
    expect(page.querySelector("#schedule-next-heading")?.textContent).toBe(
      "Next scheduled"
    );
    expect(
      busyRegions.map((region) => region.getAttribute("aria-label"))
    ).toEqual(["Loading WSF wait reports", "Loading next scheduled sailing"]);
    expect(page.querySelectorAll(".skeleton")).toHaveLength(2);
    expect(
      page.querySelector('nav[aria-label="Route quick links"]')
    ).not.toBeNull();
    page
      .querySelectorAll("h1, h2, nav a")
      .forEach((element) =>
        expect(element.closest('[role="status"]')).toBeNull()
      );
    expect(page.textContent).not.toContain("None reported");
    expect(page.textContent).not.toContain("Departure data unavailable");
    expect(page.textContent).not.toContain("No remaining sailings listed");
  });

  // unavailable remains unknown inside the compact answer cards
  it("renders a directional heading and unknown wait in a two-card mobile grid", () => {
    const page = render();
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    expect(page.querySelector("h1")?.textContent).toContain(
      "Seattle to Bainbridge"
    );
    const wait = page.querySelector(
      '[aria-labelledby="schedule-wait-heading"]'
    );
    const next = page.querySelector(
      '[aria-labelledby="schedule-next-heading"]'
    );
    expect(wait?.textContent).toContain("None reported");
    expect(wait?.textContent).not.toContain("30–60");
    expect(wait?.parentElement?.classList).toContain("grid");
    expect(wait?.parentElement?.classList).toContain("grid-cols-2");
    // verify both compact answer cards
    for (const card of [wait, next]) {
      expect(
        card?.classList.contains("bg-black") ||
          card?.classList.contains("bg-blue-dark") ||
          card?.classList.contains("bg-blue-darkest")
      ).toBe(true);
      expect(card?.classList).toContain("text-white");
    }
    expect(page.textContent).not.toContain("Plan your crossing");
    expect(page.textContent).not.toContain(
      "How to read wait times and vehicle space"
    );
    expect(page.textContent).not.toContain("This does not mean");
    expect(page.textContent).not.toContain("boarding guarantee");
  });

  // keep the date and departure answer without duplicate time-zone or source copy
  it("uses a concise next-scheduled card while preserving the selected date", () => {
    const page = render();
    const next = page.querySelector(
      '[aria-labelledby="schedule-next-heading"]'
    );

    expect(page.querySelector('time[datetime="2026-10-07"]')?.textContent).toBe(
      "October 7, 2026"
    );
    expect(page.textContent).not.toContain("Pacific time");
    expect(next?.querySelector("h2")?.textContent).toBe("Next scheduled");
    expect(next?.querySelectorAll("time")).toHaveLength(1);
    expect(next?.textContent).toContain("12:30 PM");
    expect(next?.textContent).not.toContain("Test Vessel");
    expect(next?.textContent).not.toContain("Source:");
  });

  // mirror the route footer destinations without dating today's canonical links
  it("renders icon quick links for every secondary route view", () => {
    const page = render();
    const quickLinks = page.querySelector(
      'nav[aria-label="Route quick links"]'
    );
    const links = Array.from(quickLinks?.querySelectorAll("a") ?? []);
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "What boat will I make?",
      "Ferry line cameras",
      "Terminal info",
      "Route Map",
      "How much does it cost?",
      "WSF Alerts",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/seattle/bainbridge/navigation",
      "/seattle/bainbridge/cameras",
      "/seattle/terminal",
      "/seattle/bainbridge/map",
      "/seattle/bainbridge/fare",
      "/seattle/bainbridge/alerts",
    ]);
    expect(quickLinks?.classList).toContain("flex");
    expect(quickLinks?.classList).toContain("flex-wrap");
    expect(quickLinks?.classList).not.toContain("grid");
    // keep icons and left-aligned one-line labels at natural widths
    for (const link of links) {
      expect(link.querySelector("svg")).not.toBeNull();
      expect(link.classList).toContain("w-fit");
      expect(link.classList).toContain("whitespace-nowrap");
      expect(link.classList).toContain("text-left");
      expect(link.classList).toContain("justify-start");
    }
  });

  // detect body-only reports and keep opposite-terminal context intact
  it("shows the latest matching source alert and its actual update time", () => {
    const latest = getAlert();
    const page = render({
      terminal: {
        ...terminal,
        bulletins: [
          getAlert({ date: latest.date - 60, title: "Older wait alert" }),
          latest,
        ],
      },
    });
    const wait = page.querySelector(
      '[aria-labelledby="schedule-wait-heading"]'
    );
    expect(wait?.textContent).toContain(latest.bodyText);
    expect(wait?.textContent).not.toContain("Older wait alert");
    expect(wait?.textContent).not.toContain("may describe either terminal");
    expect(wait?.textContent).not.toContain("Conditions may have changed");
    expect(wait?.querySelector("time")?.getAttribute("dateTime")).toBe(
      DateTime.fromSeconds(latest.date, { zone: "America/Los_Angeles" }).toISO()
    );
  });

  // unrelated destinations and inactive reports must not become this route's wait
  it.each([
    getAlert({ routePrefix: "SEA/BMT" }),
    getAlert({ terminalId: "3" }),
    getAlert({ level: Level.LOW }),
    getAlert({ bodyText: "A ferry delay causes a 60 Minute Wait." }),
  ])("excludes an unrelated or inactive wait alert %#", (alert) => {
    const page = render({ terminal: { ...terminal, bulletins: [alert] } });
    expect(
      page.querySelector('[aria-labelledby="schedule-wait-heading"]')
        ?.textContent
    ).toContain("None reported");
  });

  // terminal-wide alerts remain explicitly broader than a route report
  it("labels a terminal-wide alert and missing report timestamp", () => {
    const page = render({
      terminal: {
        ...terminal,
        bulletins: [getAlert({ date: 0, routePrefix: "All" })],
      },
    });
    const wait = page.querySelector(
      '[aria-labelledby="schedule-wait-heading"]'
    );
    expect(wait?.textContent).toContain("WSF terminal-wide wait alert");
    expect(wait?.textContent).toContain("Source update time unavailable");
    expect(wait?.querySelector("time")).toBeNull();
    expect(page.textContent).not.toContain("1970");
  });

  // service-day rollover follows the ferry's pacific 03:00 boundary
  it("retains current reports before 03:00 on the previous service date", () => {
    const earlyTime = time.set({ hour: 2 });
    const schedule = getSchedule("2026-10-06");
    schedule.slots[0].time = earlyTime.plus({ minutes: 30 }).toSeconds();
    const page = render({
      schedule,
      selectedDate: "2026-10-06",
      terminal: {
        ...terminal,
        bulletins: [
          getAlert({ date: earlyTime.minus({ minutes: 10 }).toSeconds() }),
        ],
      },
      time: earlyTime,
    });
    expect(
      page.querySelector('[aria-labelledby="schedule-wait-heading"]')
        ?.textContent
    ).toContain("Latest WSF route wait alert");
  });

  // dated views cannot borrow today's queue report and retain secondary-link dates
  it("withholds current alerts on another service date", () => {
    const page = render({
      selectedDate: "2026-10-08",
      schedule: getSchedule("2026-10-08"),
      terminal: { ...terminal, bulletins: [getAlert()] },
    });
    expect(
      page.querySelector('[aria-labelledby="schedule-wait-heading"]')
        ?.textContent
    ).toContain("Wait time not forecast");
    expect(
      page.querySelector('[aria-labelledby="schedule-wait-heading"]')
        ?.textContent
    ).not.toContain("60 Minute Wait");
    const quickLinks = page.querySelector(
      'nav[aria-label="Route quick links"]'
    );
    expect(quickLinks).not.toBeNull();
    expect(quickLinks?.textContent ?? "").not.toContain(
      "What boat will I make?"
    );
    expect(
      Array.from(quickLinks?.querySelectorAll("a") ?? []).map((link) =>
        link.getAttribute("href")
      )
    ).toEqual([
      "/seattle/bainbridge/cameras?date=2026-10-08",
      "/seattle/terminal?date=2026-10-08",
      "/seattle/bainbridge/map?date=2026-10-08",
      "/seattle/bainbridge/fare?date=2026-10-08",
      "/seattle/bainbridge/alerts?date=2026-10-08",
    ]);
  });

  // a cancelled next-listed departure is not an operating or catchable ferry
  it("marks cancellation and never equates departure time with queue wait", () => {
    const schedule = getSchedule();
    schedule.slots[0].cancellationReason = "tidal";
    const page = render({ schedule });
    const next = page.querySelector(
      '[aria-labelledby="schedule-next-heading"]'
    );
    expect(next?.textContent).toContain("Cancelled");
    expect(next?.querySelector("time")).not.toBeNull();
    expect(page.textContent).not.toContain("boarding guarantee");
  });
});
