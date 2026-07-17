import { Capacitor } from "@capacitor/core";
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

  it("requests Android permission before reading the location", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    geolocation.checkPermissions.mockResolvedValue({
      coarseLocation: "prompt",
      location: "prompt",
    });
    const requestPermissions = geolocation.requestPermissions.mockResolvedValue({
      coarseLocation: "granted",
      location: "granted",
    });
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
    expect(requestPermissions).toHaveBeenCalledWith({
      permissions: ["coarseLocation"],
    });
    expect(getCurrentPosition).toHaveBeenCalledAfter(requestPermissions);
  });

  it("does not read the location when Android permission is denied", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    geolocation.checkPermissions.mockResolvedValue({
      coarseLocation: "prompt",
      location: "prompt",
    });
    geolocation.requestPermissions.mockResolvedValue({
      coarseLocation: "denied",
      location: "denied",
    });
    const { getCurrentPosition } = geolocation;

    await expect(getCurrentLocation()).resolves.toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
});
