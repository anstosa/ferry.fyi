// @vitest-environment jsdom

import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const geolocation = vi.hoisted(() => ({
  getCurrentPosition: vi.fn(),
}));
const capacitor = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: capacitor }));
vi.mock("@capacitor/geolocation", () => ({ Geolocation: geolocation }));
vi.mock("../../client/lib/device", () => ({
  isNativeMobileApp: () => capacitor.isNativePlatform(),
}));

import { type Point, useGeo } from "../../client/lib/geo";

let root: Root | undefined;

interface HookProbeProps {
  onLocation: (location: Point | null) => void;
  onReady?: (requestLocation: (requestPermission?: boolean) => void) => void;
}

const HookProbe = ({ onLocation, onReady }: HookProbeProps): ReactElement => {
  const [location, updateLocation] = useGeo();
  onLocation(location);
  onReady?.((requestPermission = true) =>
    updateLocation(false, requestPermission)
  );
  return React.createElement("div");
};

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.clearAllMocks();
  capacitor.isNativePlatform.mockReturnValue(true);
});

describe("useGeo", () => {
  it("clears its refresh interval when the last consumer unmounts", async () => {
    vi.useFakeTimers();
    const clearInterval = vi.spyOn(window, "clearInterval");
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(HookProbe, { onLocation: vi.fn() }));
      await Promise.resolve();
    });
    act(() => root?.unmount());
    root = undefined;

    expect(clearInterval).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("shares a location granted from one hook with other mounted consumers", async () => {
    geolocation.getCurrentPosition.mockResolvedValue({
      coords: { latitude: 47.6, longitude: -122.3 },
    });
    let requestLocation = (): void => undefined;
    let readerLocation: Point | null = null;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(HookProbe, {
            onLocation: () => undefined,
            onReady: (request) => {
              requestLocation = request;
            },
          }),
          React.createElement(HookProbe, {
            onLocation: (location) => {
              readerLocation = location;
            },
          })
        )
      );
      await Promise.resolve();
    });

    await act(async () => {
      requestLocation();
      await Promise.resolve();
    });

    expect(readerLocation).toEqual({ latitude: 47.6, longitude: -122.3 });
  });

  it("shares an explicit opt-in with the first registered refresher", async () => {
    vi.useFakeTimers();
    geolocation.getCurrentPosition.mockResolvedValue({
      coords: { latitude: 47.6, longitude: -122.3 },
    });
    let enableLocation = (): void => undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(HookProbe, { onLocation: () => undefined }),
          React.createElement(HookProbe, {
            onLocation: () => undefined,
            onReady: (request) => {
              enableLocation = request;
            },
          })
        )
      );
      await Promise.resolve();
    });

    await act(async () => {
      enableLocation(false);
      await Promise.resolve();
    });
    expect(geolocation.getCurrentPosition).toHaveBeenCalledOnce();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it("uses one shared refresh timer for multiple mounted consumers", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("noLocation", "false");
    geolocation.getCurrentPosition.mockResolvedValue({
      coords: { latitude: 47.6, longitude: -122.3 },
    });
    const setInterval = vi.spyOn(window, "setInterval");
    const clearInterval = vi.spyOn(window, "clearInterval");
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(HookProbe, { onLocation: vi.fn() }),
          React.createElement(HookProbe, { onLocation: vi.fn() })
        )
      );
      await Promise.resolve();
    });

    expect(
      setInterval.mock.calls.length - clearInterval.mock.calls.length
    ).toBe(1);
    expect(geolocation.getCurrentPosition).toHaveBeenCalledOnce();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it("refreshes a native location after the user has already opted in", async () => {
    window.localStorage.setItem("noLocation", "false");
    geolocation.getCurrentPosition.mockResolvedValue({
      coords: { latitude: 47.7, longitude: -122.4 },
    });
    let readerLocation: Point | null = null;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(HookProbe, {
          onLocation: (location) => {
            readerLocation = location;
          },
        })
      );
      await Promise.resolve();
    });

    await vi.waitFor(() =>
      expect(geolocation.getCurrentPosition).toHaveBeenCalledWith({
        enableHighAccuracy: false,
        maximumAge: 5 * 60 * 1000,
        timeout: 30 * 1000,
      })
    );
    expect(readerLocation).toEqual({ latitude: 47.7, longitude: -122.4 });
  });
});
