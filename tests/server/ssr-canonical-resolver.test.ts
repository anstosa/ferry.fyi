import { describe, expect, it, vi } from "vitest";

import {
  createPublicSsrCanonicalResolver,
  PublicSsrTransientFailure,
} from "../../server/ssr/publicSnapshot";
import type { Terminal } from "../../shared/contracts/terminals";

const resolver = (terminals: Record<string, Terminal> = {}) => {
  const getTerminals = vi.fn(() => Promise.resolve(terminals));
  return {
    getTerminals,
    resolve: createPublicSsrCanonicalResolver({ getTerminals }),
  };
};

describe("public SSR canonical resolver", () => {
  it("handles unknown, callback, static, and manifest redirects without terminals", async () => {
    const { getTerminals, resolve } = resolver();
    await expect(
      resolve(new URL("https://ferry.fyi/nope?token=canary"))
    ).resolves.toMatchObject({
      classification: "eligible",
      match: { canonicalPath: "/404", params: {}, query: { values: {} } },
    });
    expect(
      (await resolve(new URL("https://ferry.fyi/callback?code=canary")))
        .classification
    ).toBe("private");
    expect(
      (await resolve(new URL("https://ferry.fyi/about"))).classification
    ).toBe("eligible");
    await expect(
      resolve(new URL("https://ferry.fyi/forecasting-explained?utm=canary"))
    ).resolves.toMatchObject({
      classification: "redirect",
      redirectTo: "/forecasting",
    });
    expect(getTerminals).not.toHaveBeenCalled();
  });

  it("canonicalizes aliases without terminal service or tracking queries", async () => {
    const { getTerminals, resolve } = resolver();
    await expect(
      resolve(new URL("https://ferry.fyi/cli?utm=canary"))
    ).resolves.toMatchObject({
      classification: "redirect",
      redirectTo: "/clinton",
    });
    expect(getTerminals).not.toHaveBeenCalled();
  });

  it("keeps non-terminal dynamic routes out of terminal resolution", async () => {
    const { getTerminals, resolve } = resolver();
    for (const url of [
      "https://ferry.fyi/today",
      "https://howmanyboats.today/",
      "https://ferry.fyi/leaderboards",
    ]) {
      expect((await resolve(new URL(url))).classification).toBe("eligible");
    }
    expect(getTerminals).not.toHaveBeenCalled();
  });

  it("keeps the alternate host on one canonical root identity", async () => {
    const { getTerminals, resolve } = resolver();
    await expect(
      resolve(new URL("https://howmanyboats.today/today?utm=canary"))
    ).resolves.toMatchObject({
      classification: "redirect",
      redirectTo: "/",
    });
    await expect(
      resolve(new URL("https://howmanyboats.today/about?utm=canary"))
    ).resolves.toMatchObject({
      classification: "redirect",
      redirectTo: "https://ferry.fyi/about",
    });
    expect(getTerminals).not.toHaveBeenCalled();
  });

  it("canonicalizes terminal details before terminal service access", async () => {
    const { getTerminals, resolve } = resolver();
    expect(
      (await resolve(new URL("https://ferry.fyi/seattle/terminal")))
        .classification
    ).toBe("eligible");
    await expect(
      resolve(new URL("https://ferry.fyi/seattle/bainbridge/terminal"))
    ).resolves.toMatchObject({
      classification: "redirect",
      redirectTo: "/seattle/terminal",
    });
    expect(getTerminals).not.toHaveBeenCalled();
  });

  it("treats unavailable data for a known terminal route as transient", async () => {
    const { resolve } = resolver();
    await expect(
      resolve(new URL("https://ferry.fyi/clinton"))
    ).rejects.toBeInstanceOf(PublicSsrTransientFailure);
  });

  it("keeps disabled dynamic terminal routes pure when terminal data is unavailable", async () => {
    const getTerminals = vi.fn(() => Promise.reject(Error("unavailable")));
    const resolve = createPublicSsrCanonicalResolver({ getTerminals });
    await expect(
      resolve(new URL("https://ferry.fyi/clinton"), { pureOnly: true })
    ).resolves.toMatchObject({ classification: "eligible" });
    expect(getTerminals).not.toHaveBeenCalled();
  });
});
