import { describe, expect, it } from "vitest";

import { getIosAuthFailurePath } from "../../client/lib/auth";

describe("iOS authentication failure handoff", () => {
  it("returns to the login page for native iOS callback errors", () => {
    expect(getIosAuthFailurePath(new Error("access denied"), "ios")).toBe(
      "/login"
    );
  });

  it("does not redirect stale callbacks or other platforms", () => {
    expect(getIosAuthFailurePath(new Error("Invalid state"), "ios")).toBe(
      undefined
    );
    expect(getIosAuthFailurePath(new Error("access denied"), "android")).toBe(
      undefined
    );
  });
});
