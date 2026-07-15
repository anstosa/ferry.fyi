// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FreshnessPill } from "../../client/components/FreshnessPill";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const renderPill = (element: React.ReactElement): RenderResult => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return { container, root };
};

describe("FreshnessPill", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("announces passive freshness as a status", () => {
    const { container } = renderPill(
      React.createElement(FreshnessPill, { now: 1_000, sourceUpdatedAt: 941 })
    );

    const pill = container.querySelector("[role=status]");
    expect(pill?.textContent).toBe("Updated just now");
    expect(pill?.getAttribute("aria-label")).toBe("Updated just now");
  });

  it("uses a disabled, busy button while an interactive refresh is in progress", () => {
    const onClick = vi.fn();
    const { container } = renderPill(
      React.createElement(FreshnessPill, {
        isRefreshing: true,
        now: 1_000,
        onClick,
        sourceUpdatedAt: 880,
      })
    );

    const pill = container.querySelector("button");
    expect(pill?.textContent).toBe("Refreshing…");
    expect(pill?.getAttribute("aria-label")).toBe(
      "Refresh data. Updated 2 mins ago"
    );
    expect(pill?.getAttribute("aria-busy")).toBe("true");
    expect((pill as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not render a pill without a known source timestamp", () => {
    const { container } = renderPill(
      React.createElement(FreshnessPill, { now: 1_000, sourceUpdatedAt: null })
    );

    expect(container.textContent).toBe("");
  });
});
