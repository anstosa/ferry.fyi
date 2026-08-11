// @vitest-environment jsdom

import React, { act, ReactElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageLoadError } from "../../client/components/PageLoadError";
import { ApiError } from "../../client/lib/api";

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

// page load error behavior
describe("PageLoadError", () => {
  // cleanup mounted dom
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // fallback actions
  it("shows reload and developer contact actions", () => {
    const reload = vi.fn();
    const { container } = renderElement(
      React.createElement(PageLoadError, {
        error: new Error("net::ERR_EMPTY_RESPONSE"),
        onReload: reload,
        title: "Schedule could not load",
      })
    );

    expect(container.textContent).toContain("Schedule could not load");
    expect(container.textContent).toContain("net::ERR_EMPTY_RESPONSE");
    const reloadButton = container.querySelector("button");
    const contactLink = container.querySelector("a");

    act(() => {
      reloadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(contactLink?.getAttribute("href")).toContain("mailto:dev@ferry.fyi");
  });

  // unauthorized recovery action
  it("offers logout after an unauthorized page load", () => {
    const { container } = renderElement(
      React.createElement(PageLoadError, {
        error: new ApiError(401, { error: "unauthorized" }),
        onReload: vi.fn(),
      })
    );

    const logoutLink = [...container.querySelectorAll("a")].find(
      (link) => link.textContent === "Log Out"
    );
    expect(logoutLink?.getAttribute("href")).toBe("/logout");
  });
});
