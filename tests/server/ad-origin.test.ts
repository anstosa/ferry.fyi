import { afterEach, describe, expect, it, vi } from "vitest";

import { isTrustedAdMutationOrigin } from "../../server/lib/adOrigin";

describe("ad mutation origin policy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the loopback browser origin used by split local development", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(
      isTrustedAdMutationOrigin(
        "http://localhost:4040",
        "http://server:4040"
      )
    ).toBe(true);
  });

  it("does not extend the loopback exception to production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(
      isTrustedAdMutationOrigin(
        "http://localhost:4040",
        "http://server:4040"
      )
    ).toBe(false);
  });
});
