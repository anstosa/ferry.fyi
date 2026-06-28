// @vitest-environment jsdom

import { DateTime } from "luxon";
import React, { act, ReactElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { ProjectedTiming } from "../../client/views/Schedule/projectedTiming";
import { Status } from "../../client/views/Schedule/Status";
import { Time } from "../../client/views/Schedule/Time";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

// render react tree
const renderElement = (element: ReactElement): RenderResult => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
};

const scheduledTime = DateTime.fromISO("2026-06-21T18:00:00", {
  zone: "America/Los_Angeles",
});

const timing: ProjectedTiming = {
  delayMins: 0,
  departureTime: scheduledTime,
  isCancelled: true,
  scheduledTime,
};

// cancelled row display
describe("cancelled sailing display", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // scheduled time behavior
  it("keeps the scheduled departure time visible", () => {
    const { container } = renderElement(
      React.createElement(Time, {
        context: "day",
        isNext: false,
        rowState: "normal",
        time: scheduledTime.minus({ hours: 2 }),
        timing,
      })
    );

    expect(container.textContent).toContain("6:00");
    expect(container.textContent).toContain("PM");
    expect(container.textContent).not.toContain("--");
  });

  // scheduled color behavior
  it("does not color cancelled departure times as late", () => {
    const { container } = renderElement(
      React.createElement(Time, {
        context: "day",
        isNext: false,
        rowState: "normal",
        time: scheduledTime.minus({ hours: 2 }),
        timing,
      })
    );
    const renderedTime = container.firstElementChild;

    expect(renderedTime?.className).not.toContain("text-late-light");
    expect(renderedTime?.className).not.toContain("dark:text-late-dark");
  });

  // status text behavior
  it("does not render bottom-left cancelled status text", () => {
    const { container } = renderElement(
      React.createElement(Status, {
        time: scheduledTime.minus({ hours: 2 }),
        timing,
      })
    );

    expect(container.textContent).not.toContain("Cancelled");
  });
});
