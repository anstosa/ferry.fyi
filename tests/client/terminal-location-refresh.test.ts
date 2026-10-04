// @vitest-environment jsdom
import type { Terminal } from "shared/contracts/terminals";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("~/lib/api", () => api);
vi.mock("~/lib/geo", () => ({ getDistance: vi.fn(), useGeo: () => [null] }));

// isolate the module cache and external directory between scenarios
beforeEach(() => {
  vi.resetModules();
  api.get.mockReset();
});

describe("saved terminal location refresh", () => {
  // refresh nested mate references already held by mounted map consumers
  it("updates current and cached mate dock positions from the public directory", async () => {
    const { getTerminal, getTerminals, refreshTerminalLocations } =
      await import("../../client/lib/terminals");
    const source = {
      "7": {
        id: "7",
        name: "Seattle",
        location: { latitude: 47.6, longitude: -122.3 },
        mates: [{ id: "3", location: { latitude: 47.62, longitude: -122.5 } }],
      },
      "3": {
        id: "3",
        name: "Bainbridge",
        location: { latitude: 47.62, longitude: -122.5 },
        mates: [{ id: "7", location: { latitude: 47.6, longitude: -122.3 } }],
      },
    } as unknown as Record<string, Terminal>;
    api.get.mockResolvedValueOnce(source);
    await getTerminals();
    const cached = await getTerminal("3");
    const cachedMate = cached.mates![0];
    const fresh = {
      ...source,
      "7": {
        ...source["7"],
        location: {
          ...source["7"].location,
          latitude: 47.6005,
          longitude: -122.339,
        },
      },
    };
    api.get.mockResolvedValueOnce(fresh);
    await refreshTerminalLocations("7");
    expect(cachedMate.location.latitude).toBe(47.6005);
    expect((await getTerminal("7")).location.longitude).toBe(-122.339);
    expect(api.get).toHaveBeenLastCalledWith("/terminals");
  });

  // an incomplete refresh must leave working terminal references intact
  it("rejects missing target data without clearing the cached coordinates", async () => {
    const { getTerminal, refreshTerminalLocations } =
      await import("../../client/lib/terminals");
    api.get.mockResolvedValueOnce({
      id: "7",
      location: { latitude: 47.6, longitude: -122.3 },
    });
    const cached = await getTerminal("7");
    const previous = { ...cached.location };
    api.get.mockResolvedValueOnce({});
    await expect(refreshTerminalLocations("7")).rejects.toThrow(
      "could not be refreshed"
    );
    expect((await getTerminal("7")).location).toEqual(previous);
  });
});
