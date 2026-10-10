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
const seed = vi.hoisted(() => ({ frames: null as unknown }));
vi.mock("~/lib/ssrSeed", () => ({
  // exercise unavailable public seeds at the browser handoff
  usePublicSsrSource: () => seed.frames,
}));
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
  seed.frames = null;
});

const terminal = {
  cameras: [
    {
      id: "camera-1",
      image: {
        height: 360,
        url: "https://example.test/camera.jpg",
        width: 640,
      },
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
  // rejected requests must not remain an indefinite metadata-loading state
  it("identifies unavailable conditions after a whole request fails", async () => {
    const diagnostic = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    getCameraFrames.mockRejectedValue(new Error("private request diagnostic"));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        React.createElement(Cameras, { setRoute: vi.fn(), terminal })
      );
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Image check failed");
    expect(container.textContent).toContain(
      "current conditions could not be verified"
    );
    expect(container.textContent).not.toContain("private request diagnostic");
    diagnostic.mockRestore();
  });

  // failed first checks and retained prior frames must remain visibly unverified
  it.each([
    { frameToken: null, frameUpdatedAt: null },
    { frameToken: '"prior-frame"', frameUpdatedAt: 1_000 },
  ])(
    "identifies failed frame checks and fallback images: %j",
    async (prior) => {
      getCameraFrames.mockResolvedValue({
        frames: {
          "camera-1": {
            cameraId: "camera-1",
            checkedAt: 1_001,
            error: "private upstream diagnostic",
            imageUrl: "https://example.test/camera.jpg",
            isStale: false,
            ...prior,
          },
        },
      });
      const container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root?.render(
          React.createElement(Cameras, { setRoute: vi.fn(), terminal })
        );
        await Promise.resolve();
      });
      expect(container.textContent).toContain("Image check failed");
      expect(container.textContent).toContain(
        "Treat any displayed image as last-known"
      );
      expect(container.textContent).not.toContain(
        "private upstream diagnostic"
      );
      expect(container.querySelector("img")).not.toBeNull();
      getCameraFrames.mockResolvedValue({ frames: {} });
      // a successful refresh replaces the failure warning
      await act(async () => {
        const reload = [...container.querySelectorAll("button")].find(
          (button) => button.textContent === "Reload Cameras"
        );
        reload?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });
      expect(container.textContent).not.toContain("Image check failed");
    }
  );

  // source availability must survive until a successful browser check replaces it
  it("retains an unavailable public frame seed during a pending refresh", async () => {
    seed.frames = {
      frames: {
        "camera-1": {
          cameraId: "camera-1",
          checkedAt: 1_000,
          frameToken: null,
          frameUpdatedAt: null,
          imageUrl: "https://example.test/camera.jpg",
          isStale: false,
          status: "unavailable",
        },
      },
    };
    getCameraFrames.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        React.createElement(Cameras, { setRoute: vi.fn(), terminal })
      );
      await Promise.resolve();
    });
    expect(container.textContent).toContain(
      "current conditions could not be verified"
    );
  });

  // render the actual image list without presenting static references as waits
  it("labels terminal images, camera positions and capacity references", async () => {
    getCameraFrames.mockReturnValue(new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const selected = {
      ...(terminal as object),
      cameras: [
        {
          carCapacity: 20,
          carsToBoat: null,
          id: "holding",
          image: {
            height: 360,
            url: "https://example.test/holding.jpg",
            width: 640,
          },
          location: {},
          title: "Holding Lanes",
        },
        {
          carCapacity: null,
          carsToBoat: 5,
          id: "approach",
          image: {
            height: 240,
            url: "https://example.test/approach.jpg",
            width: 320,
          },
          location: {},
          title: "Terminal Approach",
        },
      ],
      name: "Seattle",
      routes: {
        crossing: {
          normalVehicleCapacity: 100,
          terminalIds: ["terminal-1", "terminal-2"],
        },
      },
    } as never;
    await act(async () => {
      root?.render(
        React.createElement(Cameras, {
          mate: { id: "terminal-2", name: "Bainbridge Island" } as never,
          setRoute: vi.fn(),
          terminal: selected,
        })
      );
      await Promise.resolve();
    });
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe(
      "Seattle ferry terminal cameras"
    );
    expect(container.textContent).toContain("departing for Bainbridge Island");
    expect(container.querySelectorAll("h2")).toHaveLength(2);
    expect(container.querySelector("img")?.alt).toBe(
      "Traffic camera at Seattle ferry terminal: Holding Lanes"
    );
    expect(container.textContent).toContain("Static holding capacity: 20 cars");
    expect(container.textContent).toContain("Capacity reference: 0.2 sailings");
    expect(container.textContent).toContain(
      "Camera position: 5 car spaces from boarding"
    );
    const images = Array.from(container.querySelectorAll("img"));
    expect(images[0]?.getAttribute("width")).toBe("640");
    expect(images[0]?.getAttribute("height")).toBe("360");
    expect(images[0]?.parentElement?.style.aspectRatio).toBe("640 / 360");
    expect(images[1]?.parentElement?.style.aspectRatio).toBe("320 / 240");
    expect(
      container.querySelectorAll('[aria-label^="Loading camera image for"]')
    ).toHaveLength(2);
    expect(container.querySelectorAll(".skeleton")).toHaveLength(2);
  });

  // stale catalog sizes must not crop decoded frames or shrink refresh skeletons
  it("uses intrinsic image proportions and retains them while the next frame loads", async () => {
    getCameraFrames.mockResolvedValue({ frames: {} });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const selected = {
      ...(terminal as object),
      cameras: [
        {
          id: "camera-1",
          image: {
            height: 137,
            url: "https://example.test/camera.jpg",
            width: 400,
          },
          location: {},
          title: "Dock",
        },
      ],
    } as never;
    await act(async () => {
      root?.render(
        React.createElement(Cameras, { setRoute: vi.fn(), terminal: selected })
      );
      await Promise.resolve();
    });
    const image = container.querySelector("img") as HTMLImageElement;
    expect(image.parentElement?.style.aspectRatio).toBe("400 / 137");
    Object.defineProperties(image, {
      naturalHeight: { configurable: true, value: 352 },
      naturalWidth: { configurable: true, value: 480 },
    });
    const timeline = image.closest("ul")?.parentElement as HTMLElement;
    const marker = container.querySelector("h2")?.parentElement?.parentElement
      ?.firstElementChild as HTMLElement;
    const timelineBounds = vi
      .spyOn(timeline, "getBoundingClientRect")
      .mockReturnValue({ top: 100 } as DOMRect);
    // emulate the first marker moving with the committed intrinsic frame height
    const markerBounds = vi
      .spyOn(marker, "getBoundingClientRect")
      .mockImplementation(
        () =>
          ({
            top:
              image.parentElement?.style.aspectRatio === "400 / 137"
                ? 237
                : 452,
          }) as DOMRect
      );
    await act(() => image.dispatchEvent(new Event("load")));
    expect(image.classList.contains("absolute")).toBe(false);
    expect(image.classList.contains("object-cover")).toBe(false);
    expect(image.classList.contains("h-auto")).toBe(true);
    expect(image.parentElement?.style.aspectRatio).toBe("");
    expect(container.querySelector(".skeleton")).toBeNull();
    expect((timeline.firstElementChild as HTMLElement).style.top).toBe("352px");

    getCameraFrames.mockResolvedValue({
      frames: {
        "camera-1": {
          cameraId: "camera-1",
          checkedAt: 1_001,
          error: null,
          frameToken: "next-frame",
          frameUpdatedAt: 1_001,
          imageUrl: "https://example.test/camera.jpg",
          isStale: false,
        },
      },
    });
    // load a new source without falling back to the obsolete catalog shape
    await act(async () => {
      const reload = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Reload Cameras"
      );
      reload?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(image.src).toContain("?frame=next-frame");
    expect(image.parentElement?.style.aspectRatio).toBe("480 / 352");
    expect(container.querySelector(".skeleton")).not.toBeNull();
    Object.defineProperty(image, "naturalHeight", {
      configurable: true,
      value: 360,
    });
    await act(() => image.dispatchEvent(new Event("load")));
    expect(image.parentElement?.style.aspectRatio).toBe("");
    expect(image.classList.contains("absolute")).toBe(false);
    expect(container.querySelector(".skeleton")).toBeNull();
    markerBounds.mockRestore();
    timelineBounds.mockRestore();
  });

  // failed image elements must stop presenting an indefinite loading surface
  it("replaces a failed image skeleton with an honest unavailable state", async () => {
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
    expect(
      container.querySelector('[aria-label="Loading camera image for Dock"]')
    ).not.toBeNull();
    await act(() => {
      container.querySelector("img")?.dispatchEvent(new Event("error"));
    });
    expect(
      container.querySelector('[aria-label="Loading camera image for Dock"]')
    ).toBeNull();
    expect(container.textContent).toContain("Camera image unavailable");
    expect(useful.hook).toHaveBeenLastCalledWith(
      "cameras",
      "terminal-1",
      false
    );
  });

  // absent inventories must not qualify useful camera exposure
  it("names empty terminal views without claiming images or readiness", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        React.createElement(Cameras, {
          setRoute: vi.fn(),
          terminal: { ...(terminal as object), cameras: [] } as never,
        })
      );
      await Promise.resolve();
    });
    expect(container.textContent).toContain(
      "No camera views are listed for the Terminal ferry terminal"
    );
    expect(container.textContent).toContain(
      "Camera views are not available in Ferry FYI for this terminal"
    );
    expect(container.querySelector("img")).toBeNull();
    expect(useful.hook).toHaveBeenLastCalledWith(
      "cameras",
      "terminal-1",
      false
    );
  });

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
