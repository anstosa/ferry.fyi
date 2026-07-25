import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const geolocation = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  getCurrentPosition: vi.fn(),
  requestPermissions: vi.fn(),
}));
const capacitor = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: capacitor }));
vi.mock("@capacitor/geolocation", () => ({ Geolocation: geolocation }));

import {
  getCurrentLocation,
  requestCurrentLocation,
  requestForegroundLocation,
} from "../../client/lib/geo";

describe("getCurrentLocation", () => {
  beforeEach(() => {
    capacitor.isNativePlatform.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("gets the browser position without invoking native permission APIs", async () => {
    const getCurrentPosition = geolocation.getCurrentPosition.mockResolvedValue(
      {
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
      }
    );

    await expect(getCurrentLocation()).resolves.toEqual({
      latitude: 47.6,
      longitude: -122.3,
    });
    expect(getCurrentPosition).toHaveBeenCalledWith({
      enableHighAccuracy: false,
      maximumAge: 5 * 60 * 1000,
      timeout: 30 * 1000,
    });
    expect(geolocation.checkPermissions).not.toHaveBeenCalled();
    expect(geolocation.requestPermissions).not.toHaveBeenCalled();
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

  it("returns no location when the native lookup is rejected", async () => {
    geolocation.getCurrentPosition.mockRejectedValue(
      new Error("Location permission denied")
    );
    await expect(getCurrentLocation()).resolves.toBeNull();
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
    expect(geolocation.checkPermissions).not.toHaveBeenCalled();
    expect(geolocation.requestPermissions).not.toHaveBeenCalled();
  });

  it("allows a new lookup after a denied permission request", async () => {
    geolocation.getCurrentPosition
      .mockRejectedValueOnce(new Error("Location permission denied"))
      .mockResolvedValueOnce({
        coords: {
          latitude: 47.6,
          longitude: -122.3,
        },
      });

    await expect(getCurrentLocation()).resolves.toBeNull();
    await expect(getCurrentLocation()).resolves.toEqual({
      latitude: 47.6,
      longitude: -122.3,
    });
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it("shares simultaneous location lookups while Android handles permission", async () => {
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
    geolocation.getCurrentPosition.mockReturnValue(position);

    const firstLookup = getCurrentLocation();
    const secondLookup = getCurrentLocation();

    await Promise.resolve();
    expect(geolocation.getCurrentPosition).toHaveBeenCalledOnce();
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
