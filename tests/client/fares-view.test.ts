// @vitest-environment jsdom
import { DateTime } from "luxon";
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fares = vi.hoisted(() => ({
  getFareCatalog: vi.fn(),
  getFareQuote: vi.fn(),
}));
vi.mock("@capacitor/share", () => ({
  Share: {
    canShare: vi.fn().mockResolvedValue({ value: false }),
    share: vi.fn(),
  },
}));
vi.mock("~/lib/fares", () => fares);
vi.mock("~/views/Header", () => ({
  Header: ({ children }: { children: React.ReactNode }) =>
    React.createElement("header", null, children),
}));
vi.mock("~/components/DateButton", () => ({
  DateButton: () => React.createElement("div", null, "Date"),
}));
vi.mock("~/components/ExternalPillLink", () => ({
  ExternalPillLink: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));
vi.mock("~/components/FareWizardIcons", () => {
  const Icon = () => React.createElement("svg");
  return {
    fareWizardIcons: {
      bicycle: Icon,
      car: Icon,
      carSide: Icon,
      motorcycle: Icon,
      ruler: Icon,
      truck: Icon,
      undo: Icon,
      user: Icon,
      walking: Icon,
      wheelchair: Icon,
    },
  };
});
vi.mock("~/components/RouteSelector", () => ({
  RouteSelector: () => React.createElement("div", null, "Route selector"),
}));
vi.mock("~/static/images/icons/solid/share-alt.svg", () => ({
  default: () => React.createElement("svg"),
}));
import { Fares } from "../../client/views/Fares";

let root: Root | undefined;
const terminal = { id: "1", name: "Seattle", terminalUrl: null } as never;
const mate = { id: "2", name: "Bainbridge", terminalUrl: null } as never;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
});

describe("Fares", () => {
  it("renders the vehicle wizard, counters, live quote, and bottom share action", async () => {
    fares.getFareCatalog.mockResolvedValue({
      catalog: {
        fares: [
          { id: 1, label: "Adult (age 19 - 64)" },
          { id: 2, label: "Youth (age 18 and under)" },
          { id: 3, label: "Senior (age 65 & over)" },
          { id: 4, label: "Vehicle Under 22' (standard veh) & Driver" },
        ],
      },
      state: "current",
    });
    fares.getFareQuote.mockResolvedValue({
      quote: { totals: [{ amount: 10.5, type: "total" }] },
      state: "current",
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        React.createElement(Fares, {
          date: DateTime.fromISO("2026-07-18"),
          mate,
          setDate: vi.fn(),
          setRoute: vi.fn(),
          terminal,
        })
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("How are you traveling?");
    expect(container.textContent).not.toContain("1. How are you traveling?");
    const click = async (label: string): Promise<void> => {
      const button = Array.from(container.querySelectorAll("button")).find(
        (entry) => entry.textContent?.includes(label)
      );
      expect(button).toBeDefined();
      await act(async () => {
        button?.click();
        await Promise.resolve();
      });
    };
    await click("Vehicle");
    expect(container.textContent).toContain("driver age 65 or older");
    expect(
      container.querySelector(
        'a[href*="wsdot.wa.gov/ferries/rider-information/ada"]'
      )
    ).not.toBeNull();
    await click("No");
    const vehicleButtons = Array.from(container.querySelectorAll("button"));
    const standardIndex = vehicleButtons.findIndex((entry) =>
      entry.textContent?.includes("Standard")
    );
    const motorcycleIndex = vehicleButtons.findIndex((entry) =>
      entry.textContent?.includes("Motorcycle")
    );
    expect(standardIndex).toBeLessThan(motorcycleIndex);
    expect(container.textContent).toContain(
      "Taller than 7'2\" or longer than 22'"
    );
    expect(container.textContent).toContain("Under 14'");
    await click("Standard");
    expect(
      container.querySelector('[aria-label="Increase Adults"]')
    ).not.toBeNull();
    expect(
      container.querySelector('input[aria-label="Adults count"]')
    ).not.toBeNull();
    expect(container.querySelector('a[href="https://wsdot.wa.gov/ferries/fares/"]'))
      .not.toBeNull();
    expect(container.textContent).toContain("$10.50");
    expect(container.textContent).toContain("Share");
  });

  it("keeps the wizard visible and retries when a quote request fails", async () => {
    window.history.replaceState(
      null,
      "",
      "/?fareMode=vehicle&fareDriver=standard&fareVehicle=standard&fareAdults=0&fareChildren=0&fareSeniors=0"
    );
    fares.getFareCatalog.mockResolvedValue({
      catalog: {
        fares: [
          { id: 1, label: "Adult (age 19 - 64)" },
          { id: 4, label: "Vehicle Under 22' (standard veh) & Driver" },
        ],
      },
      state: "current",
    });
    fares.getFareQuote.mockRejectedValue(new Error("network failure"));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(Fares, {
          date: DateTime.fromISO("2026-07-18"),
          mate,
          setDate: vi.fn(),
          setRoute: vi.fn(),
          terminal,
        })
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Fare estimator");
    expect(container.textContent).toContain("Fare unavailable.");
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry"
    );
    expect(retry).toBeDefined();
    await act(async () => {
      retry?.click();
      await Promise.resolve();
    });
    expect(fares.getFareQuote).toHaveBeenCalledTimes(2);
  });

  it("keeps the route header and shows a wizard-shaped skeleton while the catalog loads", async () => {
    fares.getFareCatalog.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(Fares, {
          date: DateTime.fromISO("2026-07-18"),
          mate,
          setDate: vi.fn(),
          setRoute: vi.fn(),
          terminal,
        })
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Route selector");
    const loading = container.querySelector('[role="status"]');
    expect(loading?.getAttribute("aria-label")).toBe("Loading fare estimator");
    expect(loading?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(6);
  });
});
