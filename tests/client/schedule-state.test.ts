// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const freshnessPill = vi.hoisted(() => vi.fn(() => null));

vi.mock("~/lib/browser", () => ({ useQuery: () => ({}) }));
vi.mock("~/lib/terminals", () => ({
  useTerminals: () => ({ terminals: [] }),
}));
vi.mock("~/components/FreshnessPill", () => ({
  FreshnessPill: freshnessPill,
}));
vi.mock("~/components/Prompt", () => ({ Prompt: () => null }));
vi.mock("~/components/Toast", () => ({
  Toast: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/static/images/icons/solid/island-tropical.svg", () => ({
  default: () => null,
}));

import { Schedule } from "../../client/views/Schedule";

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const render = (props: Partial<React.ComponentProps<typeof Schedule>>) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      React.createElement(Schedule, {
        schedule: null,
        time: {} as never,
        ...props,
      })
    );
  });
  return container;
};

describe("Schedule load states", () => {
  it("shows the separate schedule check time", () => {
    const schedule = {
      date: "2026-08-02",
      slots: [],
      sourceUpdatedAt: 1,
    } as never;

    render({
      checkedAt: 2_000_000_000,
      onRefresh: vi.fn(),
      schedule,
    });

    expect(freshnessPill.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        sourceUpdatedAt: 2_000_000_000,
      })
    );
  });

  it("hides the check-time pill when no check time is available", () => {
    const schedule = {
      date: "2026-08-02",
      slots: [],
      sourceUpdatedAt: 1,
    } as never;

    render({ checkedAt: null, onRefresh: vi.fn(), schedule });

    expect(freshnessPill).not.toHaveBeenCalled();
  });

  it("shows the schedule error instead of the initial loading state", () => {
    const container = render({ loadError: new Error("offline") });

    expect(container.textContent).toContain("Schedule could not load");
    expect(container.textContent).toContain("offline");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("shows a loading skeleton before any schedule data arrives", () => {
    const container = render({});

    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-label")
    ).toBe("Loading schedule");
  });

  it("keeps schedule content visible when a refresh fails", () => {
    const schedule = { date: "2026-07-27", slots: [] } as never;
    const container = render({ loadError: new Error("offline"), schedule });

    expect(container.textContent).toContain("No sailings scheduled");
    expect(container.textContent).toContain(
      "Could not refresh the schedule. Showing saved data."
    );
    expect(container.textContent).not.toContain("Schedule could not load");
  });
});
