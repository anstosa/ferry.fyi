// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: () => ({ matches: false }),
});

const getCameraFrames = vi.hoisted(() => vi.fn());
vi.mock("~/lib/cameras", () => ({ getCameraFrames }));
vi.mock("~/lib/terminals", () => ({
  getSlug: (id: string) => id,
  useTerminals: () => ({ closestTerminal: null, terminals: [] }),
}));
vi.mock("~/lib/maps", () => ({ locationToUrl: () => "#" }));
vi.mock("../../client/components/ReloadButton", () => ({
  ReloadButton: ({ isReloading, onClick }: { isReloading: boolean; onClick: () => void }) =>
    React.createElement("button", { "aria-busy": isReloading, onClick }, "Reload Cameras"),
}));
vi.mock("~/components/CameraFrameFreshness", () => ({
  CameraFrameFreshness: () => null,
}));
vi.mock("~/components/TerminalDropdown", () => ({ TerminalDropdown: () => null }));
vi.mock("~/views/Header", () => ({ Header: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("~/static/images/icons/solid/car.svg", () => ({ default: () => null }));
vi.mock("~/static/images/icons/solid/location.svg", () => ({ default: () => null }));
vi.mock("~/static/images/icons/solid/map-marked.svg", () => ({ default: () => null }));
vi.mock("~/static/images/icons/solid/map-marker.svg", () => ({ default: () => null }));
vi.mock("~/static/images/icons/solid/ship.svg", () => ({ default: () => null }));
vi.mock("~/static/images/icons/wsdot.svg", () => ({ default: () => null }));

import { Cameras } from "../../client/views/Cameras";

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.clearAllMocks();
});

const terminal = {
  cameras: [{ id: "camera-1", image: { url: "https://example.test/camera.jpg" }, location: {}, title: "Dock" }],
  id: "terminal-1",
  mates: [],
  name: "Terminal",
  routes: {},
} as never;

describe("Cameras refresh state", () => {
  it("keeps passive polling from marking the manual reload button busy", async () => {
    vi.useFakeTimers();
    let resolveManual: ((value: unknown) => void) | undefined;
    getCameraFrames
      .mockResolvedValueOnce({ frames: {} })
      .mockResolvedValueOnce({ frames: {} })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveManual = resolve; }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(Cameras, { setRoute: vi.fn(), terminal }));
      await Promise.resolve();
    });
    const button = [...container.querySelectorAll("button")].find((element) => element.textContent === "Reload Cameras");
    expect(button?.getAttribute("aria-busy")).toBe("false");

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(button?.getAttribute("aria-busy")).toBe("false");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(button?.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      resolveManual?.({ frames: {} });
      await Promise.resolve();
    });
    expect(button?.getAttribute("aria-busy")).toBe("false");
  });
});
