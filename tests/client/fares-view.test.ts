// @vitest-environment jsdom
import { DateTime } from "luxon";
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  FareCatalogApiResponse,
  FareQuoteApiResponse,
  FareQuoteRequest,
} from "shared/contracts/fares";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type UsableFareQuoteResponse = Extract<
  FareQuoteApiResponse,
  { state: "current" | "stale" }
>;

const fares = vi.hoisted(() => ({
  getFareCatalog: vi.fn(),
  getFareQuote: vi.fn(),
}));
const shareAdapters = vi.hoisted(() => ({
  canShare: vi.fn(),
  clipboard: vi.fn(),
  share: vi.fn(),
}));
const analytics = vi.hoisted(() => ({
  trackUsefulEvent: vi.fn(),
}));
const useful = vi.hoisted(() => ({
  ref: vi.fn(),
  useUsefulContent: vi.fn(),
}));
vi.mock("@capacitor/share", () => ({
  Share: {
    canShare: shareAdapters.canShare,
    share: shareAdapters.share,
  },
}));
vi.mock("~/lib/analytics", () => analytics);
vi.mock("~/lib/usefulVisits", () => useful);
vi.mock("~/lib/fares", () => fares);
vi.mock("~/components/AdSlot", () => ({ AdSlot: () => null }));
vi.mock("~/views/Header", () => ({
  Header: ({ children }: { children: React.ReactNode }) =>
    React.createElement("header", null, children),
}));
vi.mock("~/components/DateButton", () => ({
  DateButton: () => React.createElement("div", null, "Date"),
}));
vi.mock("~/components/ExternalPillLink", () => ({
  ExternalPillLink: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => React.createElement("a", { href }, children),
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
import { PublicSsrSeedProvider } from "../../client/lib/ssrSeed";
import { Fares } from "../../client/views/Fares";
vi.mock("react-router-dom", () => ({
  useLocation: () => ({ search: window.location.search }),
}));

let root: Root | undefined;
const terminal = {
  abbreviation: "SEA",
  bulletins: [],
  cameras: [],
  hasElevator: false,
  hasFood: false,
  hasOverheadLoading: false,
  hasRestroom: true,
  hasWaitingRoom: true,
  id: "1",
  info: {},
  location: { address: {}, latitude: 47.6, longitude: -122.3 },
  name: "Seattle",
  popularity: 0,
  routes: {},
  terminalUrl: null,
  waitTimes: [],
} satisfies import("../../shared/contracts/terminals").Terminal;
const catalogContext = {
  kind: "catalog" as const,
  collectionDescription: "One-way fares",
  request: {
    departingTerminalId: "1",
    arrivingTerminalId: "2",
    roundTrip: false,
    tripDate: "2026-07-18" as const,
  },
  freshness: {
    fetchedAt: 1784372400,
    sourceCacheFlushDate: null,
    validFrom: "2026-01-01" as const,
    validThrough: "2026-12-31" as const,
    policyVersion: "fixture",
  },
};
const mate = {
  ...terminal,
  abbreviation: "BAI",
  id: "2",
  name: "Bainbridge",
} satisfies import("../../shared/contracts/terminals").Terminal;
beforeEach(() => {
  useful.useUsefulContent.mockReturnValue(useful.ref);
  shareAdapters.canShare.mockResolvedValue({ value: false });
  shareAdapters.share.mockResolvedValue({});
  shareAdapters.clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: shareAdapters.clipboard },
  });
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
});

// build one exact route-scoped fare catalog
const makeCatalogResponse = (
  requestOverride: Partial<typeof catalogContext.request> = {}
): FareCatalogApiResponse => ({
  catalog: {
    ...catalogContext,
    request: { ...catalogContext.request, ...requestOverride },
    fares: [
      {
        id: 1,
        label: "Adult (age 19 - 64)",
        amount: 10,
        category: "Passenger",
        directionIndependent: false,
      },
      {
        id: 4,
        label: "Vehicle Under 22' (standard veh) & Driver",
        amount: 20,
        category: "Vehicle",
        directionIndependent: false,
      },
    ],
  },
  state: "current",
});

// build one request-echoing usable quote
const makeQuoteResponse = (
  request: FareQuoteRequest,
  state: "current" | "stale" = "current"
): UsableFareQuoteResponse => ({
  ...(state === "stale"
    ? {
        calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
        staleAt: 1784372400,
      }
    : {}),
  quote: {
    freshness: catalogContext.freshness,
    kind: "quote",
    request,
    totals: [
      {
        amount: 10.5,
        briefDescription: "Total",
        description: "One-way total",
        type: "total",
      },
    ],
  },
  state,
});

// render fares and settle immediate catalog and quote work
const renderFares = async (
  props: Partial<React.ComponentProps<typeof Fares>> = {}
): Promise<HTMLDivElement> => {
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
        ...props,
      })
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
};

// click one visible button by its accessible text
const clickButton = async (
  container: HTMLElement,
  label: string
): Promise<void> => {
  const button = Array.from(container.querySelectorAll("button")).find(
    (entry) => entry.textContent?.includes(label)
  );
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
};

// restore a valid automatic walk-on quote configuration
const setWalkOnSearch = (adults = 0): void => {
  window.history.replaceState(
    null,
    "",
    `/?fareMode=walk-on&fareAdults=${adults}&fareChildren=0&fareSeniors=0`
  );
};

// restore a valid automatic vehicle quote configuration
const setVehicleSearch = (adults = 0): void => {
  window.history.replaceState(
    null,
    "",
    `/?fareMode=vehicle&fareDriver=standard&fareVehicle=standard&fareAdults=${adults}&fareChildren=0&fareSeniors=0`
  );
};

describe("Fares", () => {
  it("renders the vehicle wizard, counters, live quote, and bottom share action", async () => {
    fares.getFareCatalog.mockResolvedValue({
      catalog: {
        ...catalogContext,
        fares: [
          {
            id: 1,
            label: "Adult (age 19 - 64)",
            amount: 10,
            category: "Passenger",
            directionIndependent: false,
          },
          {
            id: 2,
            label: "Youth (age 18 and under)",
            amount: 10,
            category: "Passenger",
            directionIndependent: false,
          },
          {
            id: 3,
            label: "Senior (age 65 & over)",
            amount: 10,
            category: "Passenger",
            directionIndependent: false,
          },
          {
            id: 4,
            label: "Vehicle Under 22' (standard veh) & Driver",
            amount: 10,
            category: "Passenger",
            directionIndependent: false,
          },
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
    expect(
      container.querySelector('a[href="https://wsdot.wa.gov/ferries/fares/"]')
    ).not.toBeNull();
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
        ...catalogContext,
        fares: [
          {
            id: 1,
            label: "Adult (age 19 - 64)",
            amount: 10,
            category: "Passenger",
            directionIndependent: false,
          },
          {
            id: 4,
            label: "Vehicle Under 22' (standard veh) & Driver",
            amount: 10,
            category: "Passenger",
            directionIndependent: false,
          },
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
    expect(useful.useUsefulContent).toHaveBeenLastCalledWith(
      "fare",
      "fare:1:2:2026-07-18",
      false
    );
  });

  it("retains a seeded catalog when its first post-commit refresh fails", async () => {
    fares.getFareCatalog.mockRejectedValue(new Error("refresh unavailable"));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const snapshot = {
      sources: {
        fares: {
          outcome: "value",
          value: {
            state: "current",
            catalog: {
              ...catalogContext,
              fares: [
                {
                  id: 1,
                  label: "Seeded walk-on fare",
                  amount: 10,
                  category: "Passenger",
                  directionIndependent: false,
                },
              ],
            },
          },
        },
      },
    } as import("../../shared/contracts/ssr").PublicSsrSnapshot;

    const seededElement = React.createElement(
      PublicSsrSeedProvider,
      { snapshot },
      React.createElement(Fares, {
        date: DateTime.fromISO("2026-07-18"),
        mate,
        setDate: vi.fn(),
        setRoute: vi.fn(),
        terminal,
      })
    );
    renderToStaticMarkup(seededElement);
    expect(fares.getFareCatalog).not.toHaveBeenCalled();

    await act(async () => {
      root?.render(seededElement);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fares.getFareCatalog).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Fare estimator");
    expect(container.textContent).not.toContain("Fares unavailable");
    expect(container.textContent).toContain("Seeded walk-on fare");
    expect(container.querySelectorAll("details table")).toHaveLength(1);
    expect(
      container.querySelector('[aria-label="Fare estimator"]')
        ?.nextElementSibling?.tagName
    ).toBe("DETAILS");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it.each([
    ["departure", { departingTerminalId: "99" }],
    ["arrival", { arrivingTerminalId: "99" }],
    ["date", { tripDate: "2026-07-19" }],
    ["trip type", { roundTrip: true }],
  ] as const)(
    "rejects a seeded catalog with a mismatched %s request",
    async (_label, requestOverride) => {
      let rejectCatalog: ((reason: Error) => void) | undefined;
      const catalogRequest = new Promise((_, reject) => {
        rejectCatalog = reject;
      });
      fares.getFareCatalog.mockReturnValue(catalogRequest);
      const container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      const mismatchedSnapshot = {
        sources: {
          fares: {
            outcome: "value",
            value: {
              state: "current",
              catalog: {
                ...catalogContext,
                request: {
                  ...catalogContext.request,
                  ...requestOverride,
                },
                fares: [
                  {
                    id: 1,
                    label: "Mismatched seeded fare",
                    amount: 10,
                    category: "Passenger",
                    directionIndependent: false,
                  },
                ],
              },
            },
          },
        },
      } as import("../../shared/contracts/ssr").PublicSsrSnapshot;

      await act(async () => {
        root?.render(
          React.createElement(
            PublicSsrSeedProvider,
            { snapshot: mismatchedSnapshot },
            React.createElement(Fares, {
              date: DateTime.fromISO("2026-07-18"),
              mate,
              setDate: vi.fn(),
              setRoute: vi.fn(),
              terminal,
            })
          )
        );
        await Promise.resolve();
      });

      expect(container.textContent).not.toContain("Mismatched seeded fare");
      expect(
        container.querySelector('[aria-label="Loading fare estimator"]')
      ).not.toBeNull();

      await act(async () => {
        rejectCatalog?.(new Error("refresh unavailable"));
        await catalogRequest.catch(() => undefined);
        await Promise.resolve();
      });

      expect(container.textContent).toContain("Fares unavailable");
      expect(container.textContent).not.toContain("Mismatched seeded fare");
    }
  );

  it("does not present an unavailable seed as a current fare response", async () => {
    fares.getFareCatalog.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const unavailableSnapshot = {
      sources: {
        fares: {
          outcome: "value",
          value: {
            calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
            reason: "unavailable",
            state: "unavailable",
          },
        },
      },
    } as unknown as import("../../shared/contracts/ssr").PublicSsrSnapshot;

    await act(async () => {
      root?.render(
        React.createElement(
          PublicSsrSeedProvider,
          { snapshot: unavailableSnapshot },
          React.createElement(Fares, {
            date: DateTime.fromISO("2026-07-18"),
            mate,
            setDate: vi.fn(),
            setRoute: vi.fn(),
            terminal,
          })
        )
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector('[aria-label="Loading fare estimator"]')
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Fares unavailable");
  });

  it("replaces the seeded catalog after a successful post-commit refresh", async () => {
    let resolveCatalog: ((value: unknown) => void) | undefined;
    fares.getFareCatalog.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = resolve;
      })
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const snapshot = {
      sources: {
        fares: {
          outcome: "value",
          value: {
            state: "current",
            catalog: {
              ...catalogContext,
              fares: [
                {
                  id: 1,
                  label: "Old seeded fare",
                  amount: 10,
                  category: "Passenger",
                  directionIndependent: false,
                },
              ],
            },
          },
        },
      },
    } as import("../../shared/contracts/ssr").PublicSsrSnapshot;

    await act(async () => {
      root?.render(
        React.createElement(
          PublicSsrSeedProvider,
          { snapshot },
          React.createElement(Fares, {
            date: DateTime.fromISO("2026-07-18"),
            mate,
            setDate: vi.fn(),
            setRoute: vi.fn(),
            terminal,
          })
        )
      );
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Old seeded fare");

    await act(async () => {
      resolveCatalog?.({
        state: "current",
        catalog: {
          ...catalogContext,
          fares: [
            {
              id: 2,
              label: "Fresh refreshed fare",
              amount: 10,
              category: "Passenger",
              directionIndependent: false,
            },
          ],
        },
      });
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Fresh refreshed fare");
    expect(container.textContent).not.toContain("Old seeded fare");
  });
  // honor authoritative policy changes while retaining transient seeds
  it.each(["policy", "invalid-request", "unavailable"] as const)(
    "handles seeded first-refresh %s failures",
    async (reason) => {
      fares.getFareCatalog.mockResolvedValue({
        state: "unavailable",
        reason,
        calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
      });
      const container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      const snapshot = {
        sources: {
          fares: {
            outcome: "value",
            value: {
              state: "current",
              catalog: {
                ...catalogContext,
                fares: [
                  {
                    id: 1,
                    label: "Policy-sensitive fare",
                    amount: 10,
                    category: "Passenger",
                    directionIndependent: false,
                  },
                ],
              },
            },
          },
        },
      } as import("../../shared/contracts/ssr").PublicSsrSnapshot;
      await act(async () => {
        root?.render(
          React.createElement(
            PublicSsrSeedProvider,
            { snapshot },
            React.createElement(Fares, {
              date: DateTime.fromISO("2026-07-18"),
              mate,
              terminal,
              setDate: vi.fn(),
              setRoute: vi.fn(),
            })
          )
        );
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(container.querySelectorAll("details table")).toHaveLength(
        reason === "unavailable" ? 1 : 0
      );
      expect(container.textContent?.includes("Policy-sensitive fare")).toBe(
        reason === "unavailable"
      );
      expect(container.textContent?.includes("Fares unavailable")).toBe(
        reason !== "unavailable"
      );
    }
  );

  // expose only exact usable catalog scopes to the visibility hook
  it.each([
    ["current", makeCatalogResponse(), true],
    [
      "no-fare",
      {
        noFare: {
          freshness: catalogContext.freshness,
          kind: "no-fare",
          message: "No fare collected",
          request: catalogContext.request,
          sourceUrl: null,
        },
        state: "no-fare",
      } satisfies FareCatalogApiResponse,
      true,
    ],
    [
      "unavailable",
      {
        calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
        reason: "unavailable",
        state: "unavailable",
      } satisfies FareCatalogApiResponse,
      false,
    ],
    ["wrong route", makeCatalogResponse({ departingTerminalId: "99" }), false],
    ["wrong date", makeCatalogResponse({ tripDate: "2026-07-19" }), false],
  ] as const)(
    "wires %s fare readiness without transmitting its identity",
    async (_label, response, ready) => {
      fares.getFareCatalog.mockResolvedValue(response);
      fares.getFareQuote.mockReturnValue(new Promise(() => undefined));

      await renderFares();

      expect(useful.useUsefulContent).toHaveBeenLastCalledWith(
        "fare",
        "fare:1:2:2026-07-18",
        ready
      );
      if (ready) {
        expect(
          useful.ref.mock.calls.some(([node]) => node instanceof Element)
        ).toBe(true);
      }
      expect(
        JSON.stringify(analytics.trackUsefulEvent.mock.calls)
      ).not.toContain("fare:1:2:2026-07-18");
    }
  );

  // discard old response readiness synchronously when route scope changes
  it("turns an old fare response not-ready before the replacement request settles", async () => {
    fares.getFareCatalog.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const snapshot = {
      sources: {
        fares: { outcome: "value", value: makeCatalogResponse() },
      },
    } as import("../../shared/contracts/ssr").PublicSsrSnapshot;
    await act(async () => {
      root?.render(
        React.createElement(
          PublicSsrSeedProvider,
          { snapshot },
          React.createElement(Fares, {
            date: DateTime.fromISO("2026-07-18"),
            mate,
            setDate: vi.fn(),
            setRoute: vi.fn(),
            terminal,
          })
        )
      );
    });
    expect(useful.useUsefulContent).toHaveBeenLastCalledWith(
      "fare",
      "fare:1:2:2026-07-18",
      true
    );

    await act(async () => {
      root?.render(
        React.createElement(
          PublicSsrSeedProvider,
          { snapshot },
          React.createElement(Fares, {
            date: DateTime.fromISO("2026-07-19"),
            mate,
            setDate: vi.fn(),
            setRoute: vi.fn(),
            terminal,
          })
        )
      );
    });

    expect(useful.useUsefulContent).toHaveBeenLastCalledWith(
      "fare",
      "fare:1:2:2026-07-19",
      false
    );
  });

  // force the reactive callback ref through a meaningful branch replacement
  it("disconnects the no-fare node before observing the estimator node", async () => {
    let resolveCatalog: (value: FareCatalogApiResponse) => void = () =>
      undefined;
    fares.getFareCatalog.mockReturnValue(
      new Promise<FareCatalogApiResponse>((resolve) => {
        resolveCatalog = resolve;
      })
    );
    const noFare = {
      noFare: {
        freshness: catalogContext.freshness,
        kind: "no-fare" as const,
        message: "No fare collected",
        request: catalogContext.request,
        sourceUrl: null,
      },
      state: "no-fare" as const,
    };
    const snapshot = {
      sources: { fares: { outcome: "value", value: noFare } },
    } as import("../../shared/contracts/ssr").PublicSsrSnapshot;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        React.createElement(
          PublicSsrSeedProvider,
          { snapshot },
          React.createElement(Fares, {
            date: DateTime.fromISO("2026-07-18"),
            mate,
            setDate: vi.fn(),
            setRoute: vi.fn(),
            terminal,
          })
        )
      );
    });
    expect(container.textContent).toContain("FREE");
    expect(useful.ref.mock.calls.at(-1)?.[0]).toBeInstanceOf(Element);

    await act(async () => {
      resolveCatalog(makeCatalogResponse());
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Fare estimator");
    const refValues = useful.ref.mock.calls.map(([node]) => node);
    const disconnectIndex = refValues.lastIndexOf(null);
    expect(disconnectIndex).toBeGreaterThan(0);
    expect(refValues[disconnectIndex + 1]).toBeInstanceOf(Element);
  });

  // keep automatic restored quotes informational until a user changes the quote
  it.each(["current", "stale"] as const)(
    "tracks a user-created %s quote but not the restored quote",
    async (freshness) => {
      setVehicleSearch();
      fares.getFareCatalog.mockResolvedValue(makeCatalogResponse());
      let quoteCount = 0;
      fares.getFareQuote.mockImplementation(
        async (request: FareQuoteRequest) => {
          // reserve the requested freshness for the user-created request
          quoteCount += 1;
          return makeQuoteResponse(
            request,
            quoteCount === 1 ? "current" : freshness
          );
        }
      );
      const container = await renderFares();
      expect(fares.getFareQuote).toHaveBeenCalledOnce();
      expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();
      const increaseAdults = container.querySelector<HTMLButtonElement>(
        '[aria-label="Increase Adults"]'
      );
      expect(increaseAdults).not.toBeNull();

      await act(async () => {
        increaseAdults?.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fares.getFareQuote).toHaveBeenCalledTimes(2);
      expect(analytics.trackUsefulEvent).toHaveBeenCalledOnce();
      expect(analytics.trackUsefulEvent).toHaveBeenCalledWith(
        "fare_quote_available",
        { freshness }
      );
      expect(JSON.stringify(analytics.trackUsefulEvent.mock.calls)).not.toMatch(
        /10\.5|fareAdults|departingTerminalId|2026-07-18/
      );
    }
  );

  // accept the server's sorted echo for an unsorted multi-line ui request
  it("tracks a user quote when the server reverses normalized line items", async () => {
    setVehicleSearch();
    fares.getFareCatalog.mockResolvedValue(makeCatalogResponse());
    let quoteCount = 0;
    fares.getFareQuote.mockImplementation(async (request: FareQuoteRequest) => {
      // reorder only the user-created multi-line response echo
      quoteCount += 1;
      const response = makeQuoteResponse(request);
      if (quoteCount === 2) {
        response.quote.request = {
          ...response.quote.request,
          lineItems: [...response.quote.request.lineItems].reverse(),
        };
      }
      return response;
    });
    const container = await renderFares();
    const increaseAdults = container.querySelector<HTMLButtonElement>(
      '[aria-label="Increase Adults"]'
    );
    expect(increaseAdults).not.toBeNull();

    await act(async () => {
      increaseAdults?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const userRequest = fares.getFareQuote.mock
      .calls[1]?.[0] as FareQuoteRequest;
    expect(
      userRequest.lineItems.map(({ fareLineItemId }) => fareLineItemId)
    ).toEqual([4, 1]);
    expect(analytics.trackUsefulEvent).toHaveBeenCalledOnce();
    expect(analytics.trackUsefulEvent).toHaveBeenCalledWith(
      "fare_quote_available",
      { freshness: "current" }
    );
  });

  // bind retry success to the concrete request started by the retry button
  it("tracks a usable explicit quote retry once", async () => {
    setVehicleSearch();
    fares.getFareCatalog.mockResolvedValue(makeCatalogResponse());
    fares.getFareQuote
      .mockRejectedValueOnce(new Error("quote unavailable"))
      .mockImplementationOnce(async (request: FareQuoteRequest) =>
        makeQuoteResponse(request)
      );
    const container = await renderFares();
    expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();

    await clickButton(container, "Retry");

    expect(analytics.trackUsefulEvent).toHaveBeenCalledOnce();
    expect(analytics.trackUsefulEvent).toHaveBeenCalledWith(
      "fare_quote_available",
      { freshness: "current" }
    );
  });

  // reject unusable and mismatched user quote completions
  it.each(["unavailable", "no-fare", "missing-total", "wrong-scope"] as const)(
    "keeps a user-created %s quote silent",
    async (kind) => {
      setVehicleSearch();
      fares.getFareCatalog.mockResolvedValue(makeCatalogResponse());
      let quoteCount = 0;
      fares.getFareQuote.mockImplementation(
        async (request: FareQuoteRequest): Promise<FareQuoteApiResponse> => {
          // allow the restored quote before exercising the user result
          quoteCount += 1;
          if (quoteCount === 1) {
            return makeQuoteResponse(request);
          }
          // return the selected nonqualifying response shape
          if (kind === "unavailable") {
            return {
              calculatorUrl: "https://wsdot.wa.gov/ferries/fares/",
              reason: "unavailable",
              state: "unavailable",
            };
          }
          // preserve a truthful no-fare response without a priced total
          if (kind === "no-fare") {
            return {
              noFare: {
                freshness: catalogContext.freshness,
                kind: "no-fare",
                message: "No fare collected",
                request,
                sourceUrl: null,
              },
              state: "no-fare",
            };
          }
          const response = makeQuoteResponse(request);
          // remove the usable total while retaining a valid response envelope
          if (kind === "missing-total") {
            response.quote.totals = [];
          } else {
            // cross the returned quote into another route scope
            response.quote.request = {
              ...response.quote.request,
              departingTerminalId: "99",
            };
          }
          return response;
        }
      );
      const container = await renderFares();
      const increaseAdults = container.querySelector<HTMLButtonElement>(
        '[aria-label="Increase Adults"]'
      );
      expect(increaseAdults).not.toBeNull();

      await act(async () => {
        increaseAdults?.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fares.getFareQuote).toHaveBeenCalledTimes(2);
      expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();
    }
  );

  // consume invalid user provenance before automatic history restoration
  it("does not carry an invalid user selection into a popstate quote", async () => {
    setWalkOnSearch();
    fares.getFareCatalog.mockResolvedValue(makeCatalogResponse());
    fares.getFareQuote.mockImplementation(async (request: FareQuoteRequest) =>
      makeQuoteResponse(request)
    );
    const container = await renderFares();
    await clickButton(container, "How are you traveling?");
    await clickButton(container, "Bicycle");
    expect(fares.getFareQuote).toHaveBeenCalledOnce();

    setWalkOnSearch(2);
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fares.getFareQuote).toHaveBeenCalledTimes(2);
    expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();
  });

  // let an automatic replacement supersede an unresolved user quote silently
  it("does not qualify a user quote superseded by popstate", async () => {
    setVehicleSearch();
    fares.getFareCatalog.mockResolvedValue(makeCatalogResponse());
    let resolveUserQuote: (value: FareQuoteApiResponse) => void = () =>
      undefined;
    let userRequest: FareQuoteRequest | undefined;
    fares.getFareQuote
      .mockImplementationOnce(async (request: FareQuoteRequest) =>
        makeQuoteResponse(request)
      )
      .mockImplementationOnce(
        (request: FareQuoteRequest) =>
          new Promise<FareQuoteApiResponse>((resolve) => {
            userRequest = request;
            resolveUserQuote = resolve;
          })
      )
      .mockImplementationOnce(async (request: FareQuoteRequest) =>
        makeQuoteResponse(request)
      );
    const container = await renderFares();
    const increaseAdults = container.querySelector<HTMLButtonElement>(
      '[aria-label="Increase Adults"]'
    );
    expect(increaseAdults).not.toBeNull();
    await act(async () => {
      increaseAdults?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fares.getFareQuote).toHaveBeenCalledTimes(2);

    setVehicleSearch(2);
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fares.getFareQuote).toHaveBeenCalledTimes(3);

    await act(async () => {
      resolveUserQuote(makeQuoteResponse(userRequest!));
      await Promise.resolve();
    });
    expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();
  });

  // classify only resolved native and clipboard share attempts
  it.each([true, false])(
    "tracks a completed fare share with native=%s",
    async (native) => {
      setWalkOnSearch();
      fares.getFareCatalog.mockResolvedValue(makeCatalogResponse());
      fares.getFareQuote.mockImplementation(async (request: FareQuoteRequest) =>
        makeQuoteResponse(request)
      );
      shareAdapters.canShare.mockResolvedValue({ value: native });
      const container = await renderFares();
      window.history.replaceState(
        null,
        "",
        "/?fareMode=walk-on&secret=UV_SHARED_URL_SECRET_d901"
      );
      analytics.trackUsefulEvent.mockClear();

      await clickButton(container, "Share");

      expect(analytics.trackUsefulEvent).toHaveBeenCalledOnce();
      expect(analytics.trackUsefulEvent).toHaveBeenCalledWith(
        "share_completed",
        {
          method: native ? "share_sheet" : "clipboard",
          surface: "fare",
        }
      );
      expect(JSON.stringify(analytics.trackUsefulEvent.mock.calls)).not.toMatch(
        /UV_SHARED_URL_SECRET_d901|Seattle|Bainbridge/
      );
    }
  );

  // rejected and unavailable adapters remain nonqualifying
  it.each(["rejected", "clipboard-rejected", "missing-clipboard"] as const)(
    "keeps a %s fare share silent",
    async (kind) => {
      setWalkOnSearch();
      fares.getFareCatalog.mockResolvedValue(makeCatalogResponse());
      fares.getFareQuote.mockImplementation(async (request: FareQuoteRequest) =>
        makeQuoteResponse(request)
      );
      shareAdapters.canShare.mockResolvedValue({ value: kind === "rejected" });
      if (kind === "rejected") {
        shareAdapters.share.mockRejectedValue(new Error("cancelled"));
      } else if (kind === "clipboard-rejected") {
        shareAdapters.clipboard.mockRejectedValue(new Error("denied"));
      } else {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: undefined,
        });
      }
      const container = await renderFares();
      analytics.trackUsefulEvent.mockClear();

      await clickButton(container, "Share");

      expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();
    }
  );
});
