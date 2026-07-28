// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const getTerminal = vi.hoisted(() => vi.fn());
const getSchedule = vi.hoisted(() => vi.fn());
vi.mock("~/lib/terminals", () => ({ getSlug: (id: string) => id, getTerminal }));
vi.mock("~/lib/schedule", () => ({
  getSchedule,
  refreshSchedule: vi.fn(),
  requireScheduleResponse: (value: unknown) => value,
}));
vi.mock("~/lib/browser", () => ({ useQuery: () => ({}) }));
vi.mock("~/lib/favoriteRoutes", () => ({
  isFavoriteRoute: () => false,
  useFavoriteRoutes: () => [[], vi.fn()],
}));
vi.mock("~/components/Page", () => ({ Page: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("~/components/PageLoadError", () => ({
  PageLoadError: ({ onReload, title }: { onReload: () => void; title: string }) =>
    React.createElement("section", undefined, title, React.createElement("button", { onClick: onReload }, "Retry")),
}));
vi.mock("~/components/RouteLoadingState", () => ({ RouteLoadingState: () => React.createElement("p", undefined, "Loading route") }));
vi.mock("~/components/Footer", () => ({ Footer: () => null }));
vi.mock("~/components/DateButton", () => ({ DateButton: () => null }));
vi.mock("~/components/RouteSelector", () => ({ RouteSelector: () => null }));
vi.mock("~/components/SeoHelmet", () => ({ SeoHelmet: () => null }));
vi.mock("~/views/Header", () => ({ Header: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("../../client/views/Schedule", () => ({ Schedule: () => React.createElement("p", undefined, "Schedule ready") }));

import { Route } from "../../client/views/Route";

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const renderRoute = async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      React.createElement(MemoryRouter, { initialEntries: ["/terminal-a/terminal-b"] },
        React.createElement(Routes, undefined,
          React.createElement(RouterRoute, { path: "/:terminalSlug/:mateSlug", element: React.createElement(Route, { view: "schedule" }) })
        )
      )
    );
    await Promise.resolve();
  });
  return container;
};

describe("Route route-load errors", () => {
  it("shows the route error before the route loading state", async () => {
    getTerminal.mockRejectedValue(new Error("offline"));
    const container = await renderRoute();

    expect(container.textContent).toContain("Route could not load");
    expect(container.textContent).not.toContain("Loading route");
  });

  it("clears a route error when retry resolves the route", async () => {
    const terminal = { id: "terminal-a", mates: [{ id: "terminal-b", mates: [] }], name: "A", routes: {} };
    const mate = terminal.mates[0];
    getTerminal
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(terminal)
      .mockResolvedValueOnce(mate);
    getSchedule.mockResolvedValue({ schedule: { date: "2026-07-27", mateId: "terminal-b", slots: [], terminalId: "terminal-a" }, timestamp: 0 });
    const container = await renderRoute();
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "Retry");

    await act(async () => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getTerminal).toHaveBeenCalledTimes(3);
    expect(container.textContent).not.toContain("Route could not load");
  });
});
