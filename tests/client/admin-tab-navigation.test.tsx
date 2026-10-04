// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminTabNavigation } from "../../client/components/admin/AdminTabNavigation";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tabs = [
  { id: "access", label: "Access" },
  { id: "operations", label: "Data operations" },
  { id: "terminals", label: "Terminal locations" },
  { id: "content", label: "Content & SEO" },
];
let container: HTMLDivElement;
let root: Root;
let select: ReturnType<typeof vi.fn>;

// mount one isolated responsive navigation
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  select = vi.fn();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  act(() => {
    root.render(
      <AdminTabNavigation activeTab="access" onSelect={select} tabs={tabs} />
    );
  });
});

// release navigation fixtures
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("admin tab navigation", () => {
  // expose a bounded custom mobile list instead of a native select
  it("opens a scrolling mobile tab menu", () => {
    const trigger = container.querySelector(
      'button[aria-label="Choose admin tool"]'
    ) as HTMLButtonElement;
    act(() => trigger.click());

    const listbox = container.querySelector('[role="listbox"]');
    expect(container.querySelector("select")).toBeNull();
    expect(listbox?.className).toContain("max-h-64");
    expect(listbox?.className).toContain("overflow-y-auto");
    expect(listbox?.querySelectorAll('[role="option"]')).toHaveLength(4);
  });

  // support end and enter while returning focus to the trigger
  it("selects a keyboard-targeted tab and restores trigger focus", () => {
    const trigger = container.querySelector(
      'button[aria-label="Choose admin tool"]'
    ) as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "End" })
      );
    });
    expect(document.activeElement?.textContent).toBe("Content & SEO");

    act(() => {
      container
        .querySelector('[role="listbox"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
        );
    });

    expect(select).toHaveBeenCalledWith("content");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  // close on escape and outside pointer input without changing tabs
  it("dismisses without changing the selected tab", () => {
    const trigger = container.querySelector(
      'button[aria-label="Choose admin tool"]'
    ) as HTMLButtonElement;
    act(() => trigger.click());
    act(() => {
      container
        .querySelector('[role="listbox"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
        );
    });
    expect(select).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);

    act(() => trigger.click());
    act(() => {
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true })
      );
    });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });
});
