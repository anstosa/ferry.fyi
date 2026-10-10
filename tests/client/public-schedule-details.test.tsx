// @vitest-environment jsdom
import { DateTime } from "luxon";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PublicScheduleDetails } from "../../client/components/PublicScheduleDetails";
import type { Schedule } from "../../shared/contracts/schedules";
import { createForecastSlot } from "../fixtures/forecastSlot";

const now = DateTime.fromISO("2026-10-09T12:00:00", {
  zone: "America/Los_Angeles",
});
const schedule: Schedule = {
  date: "2026-10-09",
  key: "5-14-2026-10-09",
  terminalId: "5",
  mateId: "14",
  validRange: null,
  slots: [10, 11, 13].map((hour) => ({
    ...createForecastSlot({ fullRisk: "unlikely", spacesLeft: 15 }),
    time: now.set({ hour }).toSeconds(),
    wuid: `sailing-${hour}`,
  })),
};

// inspect history and its complete source facts before javascript
const render = (
  props: Partial<React.ComponentProps<typeof PublicScheduleDetails>> = {}
): HTMLElement => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <PublicScheduleDetails
      schedule={schedule}
      time={now}
      showDisclaimer={false}
      {...props}
    />
  );
  return container;
};

describe("public compact sailing history", () => {
  // mirror the browser's visible recent history above now without dropping source facts
  it("keeps the recent history above now as expandable compact rows", () => {
    const page = render();
    const history = page.querySelector<HTMLElement>("[data-past-sailings]")!;
    const recent = history.querySelector("[data-recent-sailings]")!;
    const marker = page.querySelector('[aria-label="Current time"]')!;
    expect(history.tagName).toBe("DIV");
    expect(history.querySelector("[data-older-sailings]")).toBeNull();
    expect(
      history.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(recent.querySelectorAll(":scope > li > details")).toHaveLength(2);
    expect(
      recent.querySelectorAll(":scope > li > details > summary")[0]?.textContent
    ).toContain("10:00 AM");
    expect(
      recent.querySelectorAll(":scope > li > details > summary")[0]?.textContent
    ).not.toContain("Test Vessel");
    expect(recent.querySelectorAll("summary svg")).toHaveLength(0);
    expect(page.querySelectorAll("[data-public-sailing]")).toHaveLength(3);
    expect(history.textContent).toContain("Estimated drive-up spaces: 15");
    expect(page.textContent).not.toContain("boarding guarantee");
    expect(page.textContent).not.toContain("What boat will I make?");
  });

  // the current schedule needs an anchor but no duplicate service-date heading
  it("can omit its header while preserving the departures anchor and list", () => {
    const page = render({ id: "departures", title: null });
    const departures = page.querySelector("#departures")!;
    expect(departures.querySelector(":scope > h2")).toBeNull();
    expect(departures.querySelectorAll("[data-public-sailing]")).toHaveLength(
      3
    );
  });

  // dated schedules are not mislabeled as completed by today's clock
  it("does not group another selected service date", () => {
    const page = render({ schedule: { ...schedule, date: "2026-10-08" } });
    expect(page.querySelector("[data-past-sailings]")).toBeNull();
    expect(page.querySelector('[aria-label="Current time"]')).toBeNull();
    expect(page.querySelectorAll("[data-public-sailing]")).toHaveLength(3);
  });

  // retain now after the complete past service date when nothing remains
  it("keeps all completed sailings above now at the end of the service date", () => {
    const page = render({ time: now.set({ hour: 23 }) });
    expect(
      page.querySelectorAll("[data-recent-sailings] > li > details > summary")
    ).toHaveLength(3);
    expect(page.querySelector("[data-older-sailings]")).toBeNull();
    expect(page.querySelector('[aria-label="Current time"]')).not.toBeNull();
  });

  // keep only history beyond the latest four behind an outer disclosure
  it("shows four recent sailings and groups only older sailings", () => {
    const completed = [5, 6, 7, 8, 9, 10].map((hour) => ({
      ...schedule.slots[0],
      time: now.set({ hour }).toSeconds(),
      wuid: `completed-${hour}`,
    }));
    const page = render({
      schedule: {
        ...schedule,
        slots: [...completed, schedule.slots[2]],
      },
    });
    const recentSummaries = page.querySelectorAll(
      "[data-recent-sailings] > li > details > summary"
    );
    const older = page.querySelector<HTMLDetailsElement>(
      "details[data-older-sailings]"
    )!;

    expect(recentSummaries).toHaveLength(4);
    expect(recentSummaries[0]?.textContent).toContain("7:00 AM");
    expect(recentSummaries[3]?.textContent).toContain("10:00 AM");
    expect(older.open).toBe(false);
    expect(older.querySelector(":scope > summary")?.textContent).toBe(
      "Earlier sailings (2)"
    );
    expect(
      older.querySelectorAll(":scope > ul > li > details > summary")
    ).toHaveLength(2);
    expect(page.querySelectorAll("[data-public-sailing]")).toHaveLength(7);
  });

  // other shared public pages retain their existing ungrouped presentation
  it("preserves the complete default source list and disclaimer without schedule context", () => {
    const page = render({ time: undefined, showDisclaimer: true });
    expect(page.querySelector("[data-past-sailings]")).toBeNull();
    expect(page.querySelectorAll("[data-public-sailing]")).toHaveLength(3);
    expect(page.textContent).toContain("boarding guarantee");
  });

  // expose factual cancellation status even before opening historical details
  it("keeps a cancelled past sailing labeled in its compact summary", () => {
    const page = render({
      schedule: {
        ...schedule,
        slots: [
          { ...schedule.slots[0], cancellationReason: "tidal" },
          ...schedule.slots.slice(1),
        ],
      },
    });
    expect(
      page.querySelector("[data-recent-sailings] details summary")?.textContent
    ).toContain("Cancelled");
  });
});
