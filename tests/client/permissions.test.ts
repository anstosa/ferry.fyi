import { describe, expect, it, vi } from "vitest";

import { requestPermissionIfNeeded } from "../../client/lib/permissions";

describe("requestPermissionIfNeeded", () => {
  it("uses a granted permission without prompting again", async () => {
    const requestPermissions = vi.fn();

    await expect(
      requestPermissionIfNeeded(
        "display",
        async () => ({ display: "granted" }),
        requestPermissions
      )
    ).resolves.toBe(true);
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it("waits for a prompted permission before continuing", async () => {
    const requestPermissions = vi.fn(async () => ({ display: "granted" }));

    await expect(
      requestPermissionIfNeeded(
        "display",
        async () => ({ display: "prompt-with-rationale" }),
        requestPermissions
      )
    ).resolves.toBe(true);
    expect(requestPermissions).toHaveBeenCalledOnce();
  });

  it("does not retry or use a denied permission", async () => {
    const requestPermissions = vi.fn();

    await expect(
      requestPermissionIfNeeded(
        "display",
        async () => ({ display: "denied" }),
        requestPermissions
      )
    ).resolves.toBe(false);
    expect(requestPermissions).not.toHaveBeenCalled();
  });
});
