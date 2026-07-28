// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { RouteLoadingState } from "../../client/components/RouteLoadingState";
import type { RouteView } from "../../client/lib/routeViews";

const views: RouteView[] = [
  "schedule",
  "cameras",
  "terminal",
  "fare",
  "map",
  "alerts",
  "subscribe",
];

describe("RouteLoadingState", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it.each(views)("renders an accessible %s loading layout", (view) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(React.createElement(RouteLoadingState, { view }));
    });

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute("aria-label")).toContain("Loading");
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(1);

    act(() => root.unmount());
  });
});
