// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../client/static/images/icons/solid/redo.svg", () => ({
  default: () => React.createElement("svg"),
}));

import { ReloadButton } from "../../client/components/ReloadButton";

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("ReloadButton", () => {
  it("is a focusable, named button that exposes manual busy state", () => {
    const onClick = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        React.createElement(ReloadButton, {
          ariaLabel: "Reload Cameras",
          isReloading: true,
          onClick,
        })
      );
    });

    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Reload Cameras");
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);

    act(() => {
      button?.focus();
      button?.click();
    });
    expect(document.activeElement).toBe(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
