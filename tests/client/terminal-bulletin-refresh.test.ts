// @vitest-environment jsdom
import { type Bulletin, Level } from "shared/contracts/bulletins";
import type { Terminal } from "shared/contracts/terminals";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("~/lib/api", () => api);

// isolate terminal cache state between request-order scenarios
beforeEach(() => {
  vi.resetModules();
  api.get.mockReset();
  api.post.mockReset();
});

// create one source alert for cache identity assertions
const bulletin = (title: string): Bulletin => ({
  bodyHTML: `<p>${title}</p>`,
  bodyText: title,
  date: 1_700_000_000,
  level: Level.HIGH,
  routePrefix: "All",
  terminalId: "5",
  title,
});

// create the narrow terminal response used by the public endpoint
const terminal = (id: string, bulletins: Bulletin[]): Terminal =>
  ({
    bulletins,
    id,
    mates: [],
    name: `Terminal ${id}`,
    routes: {},
    terminalUrl: null,
  }) as Terminal;

describe("terminal bulletin refresh cache", () => {
  // keep the latest-started terminal response after an older post finishes later
  it("does not let an older refresh overwrite a newer terminal result", async () => {
    let releaseEarlier:
      | ((result: { sourceUpdatedAt: number | null }) => void)
      | undefined;
    const fresh = terminal("5", [bulletin("45 Minute Wait")]);
    const older = terminal("5", []);
    api.post
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseEarlier = resolve;
          })
      )
      .mockResolvedValueOnce({ sourceUpdatedAt: 3 });
    api.get.mockResolvedValueOnce(fresh).mockResolvedValueOnce(older);
    const { getTerminal, refreshBulletins } =
      await import("../../client/lib/terminals");

    const earlierRefresh = refreshBulletins("5");
    const laterRefresh = refreshBulletins("5");
    await expect(laterRefresh).resolves.toEqual({
      sourceUpdatedAt: 3,
      terminal: fresh,
    });

    releaseEarlier?.({ sourceUpdatedAt: 2 });
    await expect(earlierRefresh).resolves.toEqual({
      sourceUpdatedAt: 2,
      terminal: older,
    });

    expect(await getTerminal("5")).toMatchObject({
      bulletins: fresh.bulletins,
      id: fresh.id,
    });
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  // isolate refresh ownership by terminal id
  it("allows overlapping refreshes for different terminals to populate both caches", async () => {
    let releaseClinton:
      | ((result: { sourceUpdatedAt: number | null }) => void)
      | undefined;
    const clinton = terminal("5", [bulletin("Clinton alert")]);
    const seattle = terminal("7", [bulletin("Seattle alert")]);
    api.post
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseClinton = resolve;
          })
      )
      .mockResolvedValueOnce({ sourceUpdatedAt: 4 });
    api.get.mockResolvedValueOnce(seattle).mockResolvedValueOnce(clinton);
    const { getTerminal, refreshBulletins } =
      await import("../../client/lib/terminals");

    const clintonRefresh = refreshBulletins("5");
    await expect(refreshBulletins("7")).resolves.toEqual({
      sourceUpdatedAt: 4,
      terminal: seattle,
    });
    releaseClinton?.({ sourceUpdatedAt: 3 });
    await expect(clintonRefresh).resolves.toEqual({
      sourceUpdatedAt: 3,
      terminal: clinton,
    });

    expect(await getTerminal("5")).toMatchObject({
      bulletins: clinton.bulletins,
      id: clinton.id,
    });
    expect(await getTerminal("7")).toMatchObject({
      bulletins: seattle.bulletins,
      id: seattle.id,
    });
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  // allow a failed refresh to be followed by a successful retry
  it("caches a retry after an earlier refresh fails", async () => {
    const fresh = terminal("5", [bulletin("Retry alert")]);
    api.post
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ sourceUpdatedAt: 5 });
    api.get.mockResolvedValueOnce(fresh);
    const { getTerminal, refreshBulletins } =
      await import("../../client/lib/terminals");

    await expect(refreshBulletins("5")).rejects.toThrow("offline");
    await expect(refreshBulletins("5")).resolves.toEqual({
      sourceUpdatedAt: 5,
      terminal: fresh,
    });

    expect(await getTerminal("5")).toMatchObject({
      bulletins: fresh.bulletins,
      id: fresh.id,
    });
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
