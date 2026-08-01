import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/messaging", () => ({
  getMessaging: vi.fn(),
  getToken: vi.fn(),
  isSupported: vi.fn(),
  onMessage: vi.fn(),
}));

vi.mock("../../client/lib/firebase", () => ({ firebaseApp: {} }));
vi.mock("../../client/lib/user", () => ({ useUser: vi.fn() }));
vi.mock("../../client/lib/worker", () => ({ getRegistration: vi.fn() }));

import {
  getNotificationPermission,
  requestNotificationPermission,
} from "../../client/lib/push";

describe("requestNotificationPermission", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests a missing browser notification permission", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission,
    });

    await expect(requestNotificationPermission()).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("does not prompt when notification permission is already decided", async () => {
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", {
      permission: "denied",
      requestPermission,
    });

    await expect(requestNotificationPermission()).resolves.toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("does not offer an ineffective retry after permission was denied", async () => {
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", {
      permission: "denied",
      requestPermission,
    });

    await expect(requestNotificationPermission()).resolves.toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("reports that notifications are unavailable without the browser API", () => {
    expect(getNotificationPermission()).toBeNull();
  });
});
