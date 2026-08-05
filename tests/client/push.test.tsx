// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const messaging = vi.hoisted(() => ({
  getMessaging: vi.fn(),
  getToken: vi.fn(),
  isSupported: vi.fn(),
  onMessage: vi.fn(),
}));
const worker = vi.hoisted(() => ({ getRegistration: vi.fn() }));
const user = vi.hoisted(() => ({
  response: [
    {
      fcmToken: "stale-project-token",
      isAuthenticated: true,
      user: { user_id: "auth0|rider" },
    },
    { updateUser: vi.fn() },
  ],
}));

vi.mock("firebase/messaging", () => messaging);

vi.mock("../../client/lib/firebase", () => ({ firebaseApp: {} }));
vi.mock("../../client/lib/user", () => ({ useUser: () => user.response }));
vi.mock("../../client/lib/worker", () => worker);

import {
  getNotificationPermission,
  requestNotificationPermission,
  usePush,
} from "../../client/lib/push";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;

const PushHarness = (): null => {
  usePush(false);
  return null;
};

describe("requestNotificationPermission", () => {
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("refreshes a stale saved token when permission is already granted", async () => {
    vi.stubGlobal("Notification", { permission: "granted" });
    messaging.isSupported.mockResolvedValue(true);
    messaging.getMessaging.mockReturnValue({});
    worker.getRegistration.mockResolvedValue({});
    messaging.getToken.mockResolvedValue("production-project-token");
    const container = document.createElement("div");
    root = createRoot(container);

    act(() => {
      root?.render(
        <MemoryRouter>
          <PushHarness />
        </MemoryRouter>
      );
    });

    await vi.waitFor(() =>
      expect(user.response[1].updateUser).toHaveBeenCalledWith({
        app_metadata: { fcmToken: "production-project-token" },
      })
    );
    expect(messaging.getToken).toHaveBeenCalledOnce();
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
