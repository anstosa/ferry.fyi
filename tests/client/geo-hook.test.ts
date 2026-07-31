// @vitest-environment jsdom

import React, { act, ReactElement } from "react";
import { createRoot, Root } from "react-dom/client";
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

import { Point, useGeo } from "../../client/lib/geo";

let root: Root | undefined;

interface HookProbeProps {
  onLocation: (location: Point | null) => void;
  onReady?: (requestLocation: () => void) => void;
}

const HookProbe = ({ onLocation, onReady }: HookProbeProps): ReactElement => {
  const [location, updateLocation] = useGeo();
  onLocation(location);
  onReady?.(() => updateLocation(false, true));
  return React.createElement("div");
};

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.clearAllMocks();
  capacitor.isNativePlatform.mockReturnValue(true);
});

describe("useGeo", () => {
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
    });

    await act(async () => {
      requestLocation();
      await Promise.resolve();
    });

    expect(readerLocation).toEqual({ latitude: 47.6, longitude: -122.3 });
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
