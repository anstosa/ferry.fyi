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

  // recover indexed numeric routes without upstream data or tracking state
  it.each([
    ["/3/alerts?utm_source=bing&token=canary", "/bainbridge/alerts"],
    ["/3/7/alerts", "/bainbridge/seattle/alerts"],
    ["/7/4/fare", "/seattle/bremerton/fare"],
    [
      "/7/3?date=2026-10-06&origin=canary",
      "/seattle/bainbridge?date=2026-10-06",
    ],
  ])(
    "redirects legacy %s to its slug equivalent %s",
    async (pathname, redirectTo) => {
      const { getTerminals, resolve } = resolver();
      await expect(
        resolve(new URL(`https://ferry.fyi${pathname}`))
      ).resolves.toMatchObject({ classification: "redirect", redirectTo });
      expect(getTerminals).not.toHaveBeenCalled();
    }
  );

  // unknown identifiers must not become guessed destinations
  it("keeps unknown numeric terminal routes as not found", async () => {
    const { getTerminals, resolve } = resolver();
    await expect(
      resolve(new URL("https://ferry.fyi/777/alerts"))
    ).resolves.toMatchObject({
      classification: "eligible",
      match: { canonicalPath: "/404" },
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

  it("binds canonical terminal details after redirect normalization", async () => {
    const bainbridge = {
      abbreviation: "BBG",
      id: "3",
      name: "Bainbridge",
    };
    const seattle = {
      abbreviation: "SEA",
      bulletins: [],
      cameras: [],
      hasElevator: false,
      hasFood: false,
      hasOverheadLoading: false,
      hasRestroom: true,
      hasWaitingRoom: true,
      id: "7",
      info: {},
      location: { address: {}, latitude: 47, longitude: -122 },
      mates: [bainbridge],
      name: "Seattle",
      popularity: 1,
      routes: {},
      waitTimes: [],
    } as Terminal;
    const { getTerminals, resolve } = resolver({ "7": seattle });
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
    expect(getTerminals).toHaveBeenCalledOnce();
  });

  it("keeps a multi-mate terminal-owned path canonical", async () => {
    const seattle = {
      abbreviation: "SEA",
      id: "7",
      mates: [
        { abbreviation: "BBG", id: "3", name: "Bainbridge" },
        { abbreviation: "BMT", id: "4", name: "Bremerton" },
      ],
      name: "Seattle",
    } as Terminal;
    const { resolve } = resolver({ "7": seattle });

    await expect(
      resolve(new URL("https://ferry.fyi/seattle/terminal"))
    ).resolves.toMatchObject({
      adPlacementBinding: { placementKey: "terminal--7--3" },
      classification: "eligible",
      match: { canonicalPath: "/seattle/terminal" },
    });
  });

  it("binds one-mate and explicit multi-mate ad directions", async () => {
    const clinton = {
      abbreviation: "CLI",
      id: "5",
      mates: [{ abbreviation: "MUK", id: "14", name: "Mukilteo" }],
      name: "Clinton",
    } as Terminal;
    const seattle = {
      abbreviation: "SEA",
      id: "7",
      mates: [
        { abbreviation: "BBG", id: "3", name: "Bainbridge" },
        { abbreviation: "BMT", id: "4", name: "Bremerton" },
      ],
      name: "Seattle",
    } as Terminal;
    const { resolve } = resolver({ "5": clinton, "7": seattle });

    await expect(
      resolve(new URL("https://ferry.fyi/clinton/fare"))
    ).resolves.toMatchObject({
      adPlacementBinding: { placementKey: "fare--5--14" },
      classification: "eligible",
    });
    await expect(
      resolve(new URL("https://ferry.fyi/seattle/bainbridge/fare"))
    ).resolves.toMatchObject({
      adPlacementBinding: { placementKey: "fare--7--3" },
      classification: "eligible",
    });
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
