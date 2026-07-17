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
});
