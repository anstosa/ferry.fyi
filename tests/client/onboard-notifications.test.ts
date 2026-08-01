// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { showSailingNotification } from "../../client/components/OnboardSailingBanner";

const content = {
  body: "Prepare to board",
  key: "prepare-board:fixture",
  title: "Ferry update",
  url: "/seattle/bainbridge",
};

describe("onboard sailing notifications", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not request notification permission from a timer-driven update", () => {
    const requestPermission = vi.fn();
    const Notification = vi.fn();
    Object.assign(Notification, {
      permission: "default",
      requestPermission,
    });
    vi.stubGlobal("Notification", Notification);

    expect(showSailingNotification(content)).toBe(false);

    expect(requestPermission).not.toHaveBeenCalled();
    expect(Notification).not.toHaveBeenCalled();
  });

  it("records success only after displaying an already-authorized notification", () => {
    const addEventListener = vi.fn();
    const Notification = vi.fn(function MockNotification() {
      return { addEventListener, close: vi.fn() };
    });
    Object.assign(Notification, { permission: "granted" });
    vi.stubGlobal("Notification", Notification);

    expect(showSailingNotification(content)).toBe(true);

    expect(Notification).toHaveBeenCalledOnce();
    expect(addEventListener).toHaveBeenCalledWith("click", expect.any(Function));
  });
});
