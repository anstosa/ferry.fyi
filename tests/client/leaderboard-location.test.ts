import { describe, expect, it, vi } from "vitest";

const requestCurrentLocation = vi.hoisted(() => vi.fn());
const requestNotificationPermission = vi.hoisted(() => vi.fn());

vi.mock("../../client/lib/geo", () => ({ requestCurrentLocation }));
vi.mock("../../client/lib/push", () => ({ requestNotificationPermission }));

import {
  initialLeaderboardLocationEnrollmentState,
  leaderboardInitials,
  parseLeaderboardLocationEnrollmentState,
  requestLeaderboardLocationAccess,
  requestLeaderboardNotificationAccess,
} from "../../client/lib/leaderboardLocation";

describe("leaderboard location enrollment", () => {
  it("starts unprompted until the server-controlled feature is available", () => {
    expect(initialLeaderboardLocationEnrollmentState).toEqual({
      enrollment: "unprompted",
      locationAccess: "unknown",
      notificationAccess: "unknown",
    });
  });

  it("keeps only valid consent and permission outcomes", () => {
    expect(
      parseLeaderboardLocationEnrollmentState({
        enrollment: "enrolled",
        locationAccess: "granted",
        notificationAccess: "unavailable",
      })
    ).toEqual({
      enrollment: "enrolled",
      locationAccess: "granted",
      notificationAccess: "unavailable",
    });
    expect(parseLeaderboardLocationEnrollmentState({ latitude: 47.6 })).toBe(
      initialLeaderboardLocationEnrollmentState
    );
  });

  it("derives a default label locally as initials without retaining a name", () => {
    expect(
      leaderboardInitials({ given_name: "Jane", family_name: "Santosa" })
    ).toBe("JS");
    expect(leaderboardInitials({ name: "Cher" })).toBe("C");
  });

  it("discards a granted coordinate after checking location access", async () => {
    requestCurrentLocation.mockResolvedValue({
      latitude: 47.6,
      longitude: -122.3,
    });

    await expect(requestLeaderboardLocationAccess()).resolves.toBe("granted");
  });

  it("uses the existing notification permission flow", async () => {
    requestNotificationPermission.mockResolvedValue(false);

    await expect(requestLeaderboardNotificationAccess()).resolves.toBe(
      "unavailable"
    );
  });
});
