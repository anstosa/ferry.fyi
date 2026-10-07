// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShareOptions } from "../../client/views/Menu";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: () => ({ matches: false }),
});

const useful = vi.hoisted(() => ({ hook: vi.fn(), ref: vi.fn() }));
const headerShare = vi.hoisted(() => vi.fn());
vi.mock("~/lib/usefulVisits", () => ({
  // capture readiness and node wiring without analytics side effects
  useUsefulContent: (...args: unknown[]) => {
    useful.hook(...args);
    return useful.ref;
  },
}));
const getCameraFrames = vi.hoisted(() => vi.fn());
vi.mock("~/lib/cameras", () => ({ getCameraFrames }));
vi.mock("~/lib/terminals", () => ({
  getSlug: (id: string) => id,
  useTerminals: () => ({ closestTerminal: null, terminals: [] }),
}));
vi.mock("~/lib/maps", () => ({ locationToUrl: () => "#" }));
vi.mock("~/components/AdSlot", () => ({ AdSlot: () => null }));
vi.mock("../../client/components/ReloadButton", () => ({
  ReloadButton: ({
    isReloading,
    onClick,
  }: {
    isReloading: boolean;
    onClick: () => void;
  }) =>
    React.createElement(
      "button",
      { "aria-busy": isReloading, onClick },
      "Reload Cameras"
    ),
}));
vi.mock("~/components/CameraFrameFreshness", () => ({
  CameraFrameFreshness: () => null,
}));
vi.mock("~/components/TerminalDropdown", () => ({
  TerminalDropdown: () => null,
}));
vi.mock("~/views/Header", () => ({
  // inspect the actual public sharing payload from the rendered owner
  Header: ({
    children,
    share,
  }: React.PropsWithChildren<{ share?: ShareOptions }>) => {
    headerShare(share);
    return children;
  },
}));
vi.mock("~/static/images/icons/solid/car.svg", () => ({ default: () => null }));
vi.mock("~/static/images/icons/solid/location.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/map-marked.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/map-marker.svg", () => ({
  default: () => null,
}));
vi.mock("~/static/images/icons/solid/ship.svg", () => ({
  default: () => null,
}));
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
  cameras: [
    {
      id: "camera-1",
      image: { url: "https://example.test/camera.jpg" },
      location: {},
      title: "Dock",
    },
  ],
  id: "terminal-1",
  mates: [],
  name: "Terminal",
  routes: {},
} as never;

describe("Cameras refresh state", () => {
  // camera polling cannot reset first-image terminal readiness
  it("requires a current-terminal image and stays ready across frame polls", async () => {
    vi.useFakeTimers();
    getCameraFrames.mockResolvedValue({ frames: {} });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    // render the production camera list at its current terminal
    const renderTerminal = async (selected: typeof terminal): Promise<void> => {
      await act(async () =>
        root?.render(
          React.createElement(Cameras, {
            setRoute: vi.fn(),
            terminal: selected,
          })
        )
      );
    };
    await renderTerminal(terminal);
    expect(headerShare).toHaveBeenLastCalledWith({
      shareSurface: "cameras",
      shareButtonText: "Share Cameras",
      sharedText: "Cameras for Terminal Ferry Terminal",
    });
    expect(useful.hook).toHaveBeenLastCalledWith(
      "cameras",
      "terminal-1",
      false
    );
    expect(useful.ref).toHaveBeenCalledWith(container.querySelector("ul"));
    await act(async () =>
      container.querySelector("img")?.dispatchEvent(new Event("error"))
    );
    expect(useful.hook).toHaveBeenLastCalledWith(
      "cameras",
      "terminal-1",
      false
    );
    await act(async () =>
      container.querySelector("img")?.dispatchEvent(new Event("load"))
    );
    expect(useful.hook).toHaveBeenLastCalledWith("cameras", "terminal-1", true);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(useful.hook).toHaveBeenLastCalledWith("cameras", "terminal-1", true);
    const previousImage = container.querySelector("img");
    const other = {
      ...(terminal as object),
      id: "terminal-2",
    } as typeof terminal;
    await renderTerminal(other);
    expect(useful.hook).toHaveBeenLastCalledWith(
      "cameras",
      "terminal-2",
      false
    );
    expect(container.querySelector("img")).not.toBe(previousImage);
    await act(async () => previousImage?.dispatchEvent(new Event("load")));
    expect(useful.hook).toHaveBeenLastCalledWith(
      "cameras",
      "terminal-2",
      false
    );
    const secondImage = container.querySelector("img");
    await act(async () => secondImage?.dispatchEvent(new Event("load")));
    expect(useful.hook).toHaveBeenLastCalledWith("cameras", "terminal-2", true);
    await renderTerminal(terminal);
    expect(useful.hook).toHaveBeenLastCalledWith(
      "cameras",
      "terminal-1",
      false
    );
    await act(async () =>
      container.querySelector("img")?.dispatchEvent(new Event("load"))
    );
    expect(useful.hook).toHaveBeenLastCalledWith("cameras", "terminal-1", true);
  });

  it("keeps passive polling from marking the manual reload button busy", async () => {
    vi.useFakeTimers();
    let resolveManual: ((value: unknown) => void) | undefined;
    getCameraFrames
      .mockResolvedValueOnce({ frames: {} })
      .mockResolvedValueOnce({ frames: {} })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveManual = resolve;
          })
      );
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(Cameras, { setRoute: vi.fn(), terminal })
      );
      await Promise.resolve();
    });
    const button = [...container.querySelectorAll("button")].find(
      (element) => element.textContent === "Reload Cameras"
    );
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

  it("pauses camera polling while the page is hidden", async () => {
    vi.useFakeTimers();
    let visibilityState: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    getCameraFrames.mockResolvedValue({ frames: {} });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(Cameras, { setRoute: vi.fn(), terminal })
      );
      await Promise.resolve();
    });
    expect(getCameraFrames).toHaveBeenCalledOnce();

    visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(getCameraFrames).toHaveBeenCalledOnce();

    visibilityState = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(getCameraFrames).toHaveBeenCalledTimes(2);
  });
});
