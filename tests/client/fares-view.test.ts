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

vi.mock("~/lib/fares", () => fares);
vi.mock("~/views/Header", () => ({
  Header: ({ children }: { children: React.ReactNode }) =>
    React.createElement("header", null, children),
}));
vi.mock("~/components/DateButton", () => ({
  DateButton: () => React.createElement("div", null, "Date"),
}));
vi.mock("~/components/InlineLoader", () => ({
  InlineLoader: () => React.createElement("div", null, "Loading"),
}));

import { Fares } from "../../client/views/Fares";

let root: Root | undefined;

const terminal = { id: "1", name: "Seattle", terminalUrl: null } as never;
const mate = { id: "2", name: "Bainbridge", terminalUrl: null } as never;

const render = async (): Promise<HTMLDivElement> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      React.createElement(Fares, {
        date: DateTime.fromISO("2026-07-18"),
        mate,
        setDate: vi.fn(),
        terminal,
      })
    );
    await Promise.resolve();
  });
  return container;
};

const rerender = async (date: DateTime): Promise<void> => {
  await act(async () => {
    root?.render(
      React.createElement(Fares, {
        date,
        mate,
        setDate: vi.fn(),
        terminal,
      })
    );
    await Promise.resolve();
  });
};

const flushEffects = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("Fares", () => {
  it("renders neutral official line items and a current total", async () => {
    fares.getFareCatalog.mockResolvedValue({
      catalog: {
        collectionDescription: null,
        fares: [
          {
            amount: 10.5,
            category: "Passenger",
            directionIndependent: false,
            id: 11,
            label: "Adult passenger",
          },
        ],
      },
      state: "current",
    });
    fares.getFareQuote.mockResolvedValue({
      quote: {
        totals: [
          {
            amount: 10.5,
            briefDescription: "Total",
            description: "Total",
            type: "total",
          },
        ],
      },
      state: "current",
    });
    const container = await render();
    await flushEffects();

    expect(container.textContent).toContain("Adult passenger");
    expect(container.textContent).toContain(
      "Ferry FYI does not determine eligibility."
    );
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "Calculate fare"
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Official total: $10.50");
  });

  it("renders no-fare and unavailable calculator states", async () => {
    fares.getFareCatalog.mockResolvedValueOnce({
      noFare: {
        message: "Fare is collected in the other direction.",
        sourceUrl: "https://example.test/fare",
      },
      state: "no-fare",
    });
    let container = await render();
    await flushEffects();
    expect(container.textContent).toContain("$0.00 fare");
    expect(container.textContent).toContain(
      "Fare is collected in the other direction."
    );

    act(() => root?.unmount());
    fares.getFareCatalog.mockResolvedValueOnce({
      calculatorUrl: "https://example.test/calculator",
      reason: "unavailable",
      state: "unavailable",
    });
    container = await render();
    await flushEffects();
    expect(container.textContent).toContain("Fares unavailable");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.test/calculator"
    );
  });

  it("does not render a late quote after the fare catalog identity changes", async () => {
    let resolveQuote: (value: unknown) => void;
    fares.getFareCatalog.mockResolvedValue({
      catalog: {
        collectionDescription: null,
        fares: [
          {
            amount: 10.5,
            category: "Passenger",
            directionIndependent: false,
            id: 11,
            label: "Adult passenger",
          },
        ],
      },
      state: "current",
    });
    fares.getFareQuote.mockReturnValue(
      new Promise((resolve) => {
        resolveQuote = resolve;
      })
    );
    const container = await render();
    await flushEffects();
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "Calculate fare"
    );
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await rerender(DateTime.fromISO("2026-07-19"));
    await flushEffects();
    await act(async () => {
      resolveQuote?.({
        quote: {
          totals: [
            {
              amount: 10.5,
              briefDescription: "Total",
              description: "Total",
              type: "total",
            },
          ],
        },
        state: "current",
      });
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Official total: $10.50");
  });
});
