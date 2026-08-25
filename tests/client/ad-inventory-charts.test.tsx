// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import type { AdInventoryReport } from "shared/contracts/ads";
import type { Terminal } from "shared/contracts/terminals";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdInventoryCharts } from "../../client/components/AdInventoryCharts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const terminals = [
  { id: "3", name: "Bainbridge" },
  { id: "7", name: "Seattle" },
] as Terminal[];

const report: AdInventoryReport = {
  daily: [
    {
      businessDate: "2026-08-17",
      opportunityCount: "30",
      placementKey: "schedule--3--7",
    },
    {
      businessDate: "2026-08-17",
      opportunityCount: "20",
      placementKey: "home",
    },
  ],
  endDate: "2026-08-17",
  placements: [
    { opportunityCount: "30", placementKey: "schedule--3--7" },
    { opportunityCount: "20", placementKey: "home" },
  ],
  selectedPlacement: {
    hourOfDay: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      opportunityCount: hour === 8 ? "12" : "0",
    })),
    hourlyDataStartDate: "2026-08-17",
    opportunityCount: "30",
    placementKey: "schedule--3--7",
    weekday: Array.from({ length: 7 }, (_, index) => ({
      opportunityCount: index === 0 ? "30" : "0",
      weekday: index + 1,
    })),
  },
  startDate: "2026-08-17",
  totalOpportunityCount: "50",
};

// cover aggregate and placement chart behavior
describe("AdInventoryCharts", () => {
  // render exact aggregate and temporal metrics
  it("selects placements and exposes weekday and hourly values", () => {
    const onSelectPlacement = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <AdInventoryCharts
          loading={false}
          onSelectPlacement={onSelectPlacement}
          report={report}
          selectedPlacementKey="schedule--3--7"
          terminals={terminals}
        />
      );
    });

    const opportunities = [...container.querySelectorAll("dt")].find(
      (term) => term.textContent === "Opportunities"
    )?.parentElement;
    expect(opportunities?.querySelector("dd")?.textContent).toBe("50");
    const selectedPlacement = container.querySelector(
      'button[aria-pressed="true"]'
    );
    const selectedCard = selectedPlacement?.closest("li");
    expect(selectedPlacement?.textContent).toContain(
      "Schedule · Bainbridge → Seattle"
    );
    expect(selectedPlacement?.getAttribute("aria-expanded")).toBe("true");
    expect(selectedCard?.textContent).toContain("Day of week");
    expect(selectedCard?.textContent).toContain("Time of day");
    expect(selectedCard?.querySelectorAll("figure")).toHaveLength(2);
    expect(
      [...container.querySelectorAll("figure")].every((figure) =>
        selectedCard?.contains(figure)
      )
    ).toBe(true);
    const dayOfWeek = [
      ...(selectedCard?.querySelectorAll("figure") ?? []),
    ].find(
      (figure) =>
        figure.querySelector("figcaption")?.textContent === "Day of week"
    );
    const dayAxis = dayOfWeek?.querySelector(
      'ul[aria-label="Day of week x-axis"]'
    );
    expect(
      dayAxis?.querySelector('li[aria-label="Monday: 30"]')
    ).not.toBeNull();
    expect(dayAxis?.textContent).toContain("Mon");
    const timeOfDay = [
      ...(selectedCard?.querySelectorAll("figure") ?? []),
    ].find(
      (figure) =>
        figure.querySelector("figcaption")?.textContent === "Time of day"
    );
    const hourAxis = timeOfDay?.querySelector(
      'ul[aria-label="Time of day x-axis"]'
    );
    expect(hourAxis?.children).toHaveLength(24);
    const eightAm = hourAxis?.querySelector('li[aria-label="8 AM: 12"]');
    expect(eightAm?.querySelector("strong")?.textContent).toBe("12");
    expect(eightAm?.lastElementChild?.textContent).toBe("8 AM");

    const home = [
      ...container.querySelectorAll('button[aria-pressed="false"]'),
    ].find((button) => button.textContent?.startsWith("Home"));
    expect(home?.closest("li")?.querySelector("figure")).toBeNull();
    act(() => home?.click());

    expect(onSelectPlacement).toHaveBeenCalledWith("home");
  });
});
