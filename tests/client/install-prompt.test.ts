// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({
  trackProductEvent: vi.fn(),
  trackUsefulEvent: vi.fn(),
}));

vi.mock("../../client/lib/analytics", () => analytics);

import {
  hasInstallPrompt,
  triggerInstallPrompt,
} from "../../client/lib/installPrompt";

describe("install prompt", () => {
  beforeEach(() => {
    window.dispatchEvent(new Event("appinstalled"));
    analytics.trackProductEvent.mockClear();
    analytics.trackUsefulEvent.mockClear();
  });

  it("retains a gesture-blocked prompt for a manual retry", async () => {
    const prompt = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("user gesture required"))
      .mockResolvedValueOnce();
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
    });
    window.dispatchEvent(event);

    expect(hasInstallPrompt()).toBe(true);
    await expect(triggerInstallPrompt()).resolves.toBe(false);
    expect(hasInstallPrompt()).toBe(true);
    expect(analytics.trackProductEvent).not.toHaveBeenCalled();
    expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();
    await expect(triggerInstallPrompt()).resolves.toBe(true);
    expect(hasInstallPrompt()).toBe(false);
  });

  // accepted prompt intent is not installation
  it("records a displayed prompt and its accepted choice without claiming installation", async () => {
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
    });
    window.dispatchEvent(event);

    await expect(triggerInstallPrompt()).resolves.toBe(true);

    expect(analytics.trackProductEvent.mock.calls).toEqual([
      ["install_prompt", { result: "opened" }],
      ["install_prompt", { result: "accepted" }],
    ]);
    expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();
  });

  // dismissed prompt intent is not useful
  it("records a dismissed choice without qualifying the visit", async () => {
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
    });
    window.dispatchEvent(event);

    await expect(triggerInstallPrompt()).resolves.toBe(true);

    expect(analytics.trackProductEvent.mock.calls).toEqual([
      ["install_prompt", { result: "opened" }],
      ["install_prompt", { result: "dismissed" }],
    ]);
    expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();
  });

  // missing choices remain unknown
  it("keeps an opened prompt truthful when the browser omits its choice", async () => {
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      userChoice: Promise.reject(new Error("choice unavailable")),
    });
    window.dispatchEvent(event);

    await expect(triggerInstallPrompt()).resolves.toBe(true);

    expect(analytics.trackProductEvent).toHaveBeenCalledOnce();
    expect(analytics.trackProductEvent).toHaveBeenCalledWith("install_prompt", {
      result: "opened",
    });
  });

  // browser confirmation qualifies installation
  it("qualifies only the browser-confirmed installed milestone", () => {
    window.dispatchEvent(new Event("appinstalled"));

    expect(analytics.trackUsefulEvent).toHaveBeenCalledOnce();
    expect(analytics.trackUsefulEvent).toHaveBeenCalledWith(
      "pwa_install_completed"
    );
    expect(analytics.trackProductEvent).not.toHaveBeenCalled();
  });
});
