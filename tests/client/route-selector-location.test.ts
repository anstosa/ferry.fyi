// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveNoLocation: vi.fn(),
  updateGeo: vi.fn(),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("~/components/Prompt", () => ({
  Prompt: ({
    actions,
  }: {
    actions: Array<{ label: string; onClick?: () => void }>;
  }) =>
    React.createElement(
      "div",
      null,
      actions.map((action) =>
        React.createElement(
          "button",
          { key: action.label, onClick: action.onClick },
          action.label
        )
      )
    ),
}));
vi.mock("~/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("~/lib/browser", () => ({
  useLocalStorage: () => [undefined, mocks.saveNoLocation],
}));
vi.mock("~/lib/geo", () => ({
  useGeo: () => [null, mocks.updateGeo],
}));
vi.mock("~/lib/terminals", () => ({
  getSlug: (id: string) => id,
  useTerminals: () => ({ closestTerminal: null, terminals: [] }),
}));
vi.mock("~/static/images/icons/solid/arrow-right.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/exchange.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/location.svg", () => ({
  default: () => null,
}));
vi.mock("../../client/components/TerminalDropdown", () => ({
  TerminalDropdown: () => null,
}));

import { RouteSelector } from "../../client/components/RouteSelector";
import type { Terminal } from "../../shared/contracts/terminals";

const terminal = (id: string, name: string) =>
  ({ id, mates: [], name }) as unknown as Terminal;

describe("RouteSelector location permission", () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  const renderSelector = async (): Promise<HTMLButtonElement> => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(RouteSelector, {
            mate: terminal("mate", "Mate"),
            setRoute: vi.fn(),
            terminal: terminal("terminal", "Terminal"),
          })
        )
      );
    });
    return Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sure!"
    )!;
  };

  it("requests browser permission synchronously from the click handler", async () => {
    const button = await renderSelector();

    act(() => button.click());

    expect(mocks.saveNoLocation).toHaveBeenCalledWith(false);
    expect(mocks.updateGeo).toHaveBeenCalledWith(false, true);
  });

  it("does not start overlapping permission requests from repeated taps", async () => {
    const button = await renderSelector();

    act(() => button.click());
    act(() => button.click());

    expect(mocks.updateGeo).toHaveBeenCalledOnce();
  });
});
