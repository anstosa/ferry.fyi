// @vitest-environment jsdom

import { readFileSync } from "node:fs";

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { Skeleton, SkeletonGroup } from "../../client/components/Skeleton";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const renderElement = (element: React.ReactElement): RenderResult => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return { container, root };
};

describe("Skeleton loading primitives", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps decorative shapes hidden from assistive technology", () => {
    const { container } = renderElement(
      React.createElement(Skeleton, { className: "w-24", variant: "circle" })
    );

    const shape = container.firstElementChild;
    expect(shape?.getAttribute("aria-hidden")).toBe("true");
    expect(shape?.className).toContain("skeleton--circle");
  });

  it("announces a related set of shapes through one named busy status", () => {
    const { container } = renderElement(
      React.createElement(
        SkeletonGroup,
        { label: "Loading sailings" },
        React.createElement(Skeleton, { variant: "text" }),
        React.createElement(Skeleton, { variant: "text" })
      )
    );

    const statuses = container.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].getAttribute("aria-label")).toBe("Loading sailings");
    expect(statuses[0].getAttribute("aria-live")).toBe("polite");
    expect(statuses[0].getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it("provides theme-aware shimmer styles with a static reduced-motion fallback", () => {
    const styles = readFileSync("client/app.scss", "utf-8");

    expect(styles).toContain("html.dark .skeleton");
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.skeleton\s*\{[\s\S]*?animation: none/
    );
  });
});
