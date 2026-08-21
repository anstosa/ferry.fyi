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

    expect(container.textContent).toContain("50");
    expect(container.textContent).toContain(
      "Schedule · Bainbridge → Seattle"
    );
    expect(container.textContent).toContain("Day of week");
    expect(container.textContent).toContain("Monday");
    expect(container.textContent).toContain("Time of day");
    expect(container.textContent).toContain("8 AM");
    expect(container.textContent).toContain("12");

    const home = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Home")
    );
    act(() => home?.click());

    expect(onSelectPlacement).toHaveBeenCalledWith("home");
  });
});
