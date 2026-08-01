import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const geolocation = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  getCurrentPosition: vi.fn(),
  requestPermissions: vi.fn(),
  then: vi.fn(() => {
    throw new Error('"Geolocation.then()" is not implemented on web');
  }),
}));
const capacitor = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
}));
const browserGeolocation = vi.hoisted(() => ({
  getCurrentPosition: vi.fn(),
}));
const browserPermissions = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: capacitor }));
vi.mock("@capacitor/geolocation", () => ({ Geolocation: geolocation }));
vi.mock("../../client/lib/device", () => ({
  isNativeMobileApp: () => capacitor.isNativePlatform(),
}));

import {
  getCurrentLocation,
  hasGeoPermissions,
  requestCurrentLocation,
  requestForegroundLocation,
} from "../../client/lib/geo";

describe("getCurrentLocation", () => {
  beforeEach(() => {
    capacitor.isNativePlatform.mockReturnValue(false);
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: browserGeolocation,
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: browserPermissions,
    });
    browserPermissions.query.mockResolvedValue({ state: "prompt" });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("gets the browser position without invoking native permission APIs", async () => {
    browserGeolocation.getCurrentPosition.mockImplementation((success) =>
      success({
        coords: {
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          latitude: 47.6,
          longitude: -122.3,
          speed: null,
        },
        timestamp: 0,
      })
    );

    await expect(getCurrentLocation()).resolves.toEqual({
      latitude: 47.6,
      longitude: -122.3,
    });
    expect(browserGeolocation.getCurrentPosition).toHaveBeenCalledOnce();
    expect(browserGeolocation.getCurrentPosition.mock.calls[0][2]).toEqual({
      enableHighAccuracy: false,
      maximumAge: 5 * 60 * 1000,
      timeout: 30 * 1000,
    });
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(geolocation.checkPermissions).not.toHaveBeenCalled();
    expect(geolocation.requestPermissions).not.toHaveBeenCalled();
  });

  it("recognizes an existing browser geolocation grant", async () => {
    browserPermissions.query.mockResolvedValue({ state: "granted" });

    await expect(hasGeoPermissions()).resolves.toBe(true);
    expect(browserPermissions.query).toHaveBeenCalledWith({
      name: "geolocation",
    });
  });

  it("falls back when a browser cannot query geolocation permission", async () => {
    browserPermissions.query.mockRejectedValue(new Error("unsupported"));

    await expect(hasGeoPermissions()).resolves.toBeUndefined();
  });

  it("uses a fresh high-accuracy position for an explicit foreground check-in", async () => {
    geolocation.getCurrentPosition.mockResolvedValue({
      coords: { accuracy: 8, latitude: 47.6, longitude: -122.3 },
      timestamp: 1_700_000_000_000,
    });

    await expect(requestForegroundLocation()).resolves.toEqual({
      accuracyMeters: 8,
      latitude: 47.6,
      longitude: -122.3,
      observedAt: "2023-11-14T22:13:20.000Z",
    });
    expect(geolocation.getCurrentPosition).toHaveBeenCalledWith({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 30 * 1000,
    });
  });

  it("returns no location when the browser lookup is rejected", async () => {
    browserGeolocation.getCurrentPosition.mockImplementation(
      (_success, error) => error(new Error("Location permission denied"))
    );
    await expect(getCurrentLocation()).resolves.toBeNull();
  });

  it("starts browser geolocation before returning from the user action", async () => {
    let resolvePosition: (position: GeolocationPosition) => void = () =>
      undefined;
    browserGeolocation.getCurrentPosition.mockImplementation((success) => {
      resolvePosition = success;
    });

    const request = requestCurrentLocation();

    expect(browserGeolocation.getCurrentPosition).toHaveBeenCalledOnce();
    resolvePosition({
      coords: { latitude: 47.6, longitude: -122.3 },
    } as GeolocationPosition);
    await request;
  });

  it("does not open an Android permission dialog during a background refresh", async () => {
    capacitor.isNativePlatform.mockReturnValue(true);

    await expect(getCurrentLocation()).resolves.toBeNull();

    expect(geolocation.checkPermissions).not.toHaveBeenCalled();
    expect(geolocation.requestPermissions).not.toHaveBeenCalled();
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("uses the native position lookup only from the explicit location action", async () => {
    capacitor.isNativePlatform.mockReturnValue(true);
    geolocation.getCurrentPosition.mockResolvedValue({
      coords: { latitude: 47.6, longitude: -122.3 },
    });

    await expect(requestCurrentLocation()).resolves.toEqual({
      latitude: 47.6,
      longitude: -122.3,
    });

    expect(geolocation.getCurrentPosition).toHaveBeenCalledWith({
      enableHighAccuracy: false,
      maximumAge: 5 * 60 * 1000,
      timeout: 30 * 1000,
    });
    expect(geolocation.then).not.toHaveBeenCalled();
    expect(geolocation.checkPermissions).not.toHaveBeenCalled();
    expect(geolocation.requestPermissions).not.toHaveBeenCalled();
  });

  it("allows a new lookup after a denied permission request", async () => {
    browserGeolocation.getCurrentPosition
      .mockImplementationOnce((_success, error) =>
        error(new Error("Location permission denied"))
      )
      .mockImplementationOnce((success) =>
        success({ coords: { latitude: 47.6, longitude: -122.3 } })
      );

    await expect(getCurrentLocation()).resolves.toBeNull();
    await expect(getCurrentLocation()).resolves.toEqual({
      latitude: 47.6,
      longitude: -122.3,
    });
    expect(browserGeolocation.getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it("shares simultaneous browser location lookups", async () => {
    const uninitializedResolver = (): never => {
      throw new Error("Expected the location resolver to be initialized");
    };
    let resolvePosition: (position: {
      coords: { latitude: number; longitude: number };
    }) => void = uninitializedResolver;
    const position = new Promise<{
      coords: { latitude: number; longitude: number };
    }>((resolve) => {
      resolvePosition = resolve;
    });
    browserGeolocation.getCurrentPosition.mockImplementation((success) => {
      position.then(success);
    });

    const firstLookup = getCurrentLocation();
    const secondLookup = getCurrentLocation();

    await vi.waitFor(() =>
      expect(browserGeolocation.getCurrentPosition).toHaveBeenCalledOnce()
    );
    resolvePosition({ coords: { latitude: 47.6, longitude: -122.3 } });

    await expect(firstLookup).resolves.toEqual({
      latitude: 47.6,
      longitude: -122.3,
    });
    await expect(secondLookup).resolves.toEqual({
      latitude: 47.6,
      longitude: -122.3,
    });
  });
});
