// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  hasInstallPrompt,
  triggerInstallPrompt,
} from "../../client/lib/installPrompt";

describe("install prompt", () => {
  beforeEach(() => {
    window.dispatchEvent(new Event("appinstalled"));
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
    await expect(triggerInstallPrompt()).resolves.toBe(true);
    expect(hasInstallPrompt()).toBe(false);
  });
});
