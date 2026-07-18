import { afterEach, describe, expect, it, vi } from "vitest";

const geolocation = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  getCurrentPosition: vi.fn(),
  requestPermissions: vi.fn(),
}));

vi.mock("@capacitor/geolocation", () => ({ Geolocation: geolocation }));

import { getCurrentLocation } from "../../client/lib/geo";

describe("getCurrentLocation", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("lets the native position lookup request coarse location access", async () => {
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
    });
    expect(geolocation.checkPermissions).not.toHaveBeenCalled();
    expect(geolocation.requestPermissions).not.toHaveBeenCalled();
  });

  it("returns no location when the native lookup is rejected", async () => {
    geolocation.getCurrentPosition.mockRejectedValue(
      new Error("Location permission denied")
    );
    await expect(getCurrentLocation()).resolves.toBeNull();
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
