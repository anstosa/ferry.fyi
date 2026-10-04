import type { Terminal } from "shared/contracts/terminals";
import { describe, expect, it, vi } from "vitest";

import {
  applyTerminalDocks,
  createTerminalLocationService,
  parseTerminalLocations,
  type TerminalLocationStore,
} from "../../server/lib/terminalLocations";

const booth = { latitude: 47.6001, longitude: -122.3371 };
const dock = { latitude: 47.601, longitude: -122.339 };
const terminal = {
  id: "7",
  name: "Seattle",
  abbreviation: "SEA",
  location: {
    latitude: 47.6,
    longitude: -122.33,
    address: { city: "Seattle" },
  },
} as Terminal;

// isolate persistence from the refreshed upstream cache
const makeFixture = () => {
  const row = {
    terminalId: "7",
    booth,
    dock,
    updatedAt: new Date("2026-10-03T12:00:00Z"),
  };
  const store: TerminalLocationStore = {
    list: vi.fn().mockResolvedValue([row]),
    read: vi.fn().mockResolvedValue(row),
    save: vi.fn().mockResolvedValue(row),
  };
  const getTerminals = vi.fn().mockResolvedValue([terminal]);
  return {
    store,
    getTerminals,
    service: createTerminalLocationService({ store, getTerminals }),
  };
};

describe("terminal booth and dock settings", () => {
  // allow independent point setting and explicit clearing
  it.each([
    { booth, dock },
    { booth, dock: null },
    { booth: null, dock },
    { booth: null, dock: null },
  ])("accepts a complete bounded replacement %j", (points) => {
    expect(parseTerminalLocations(points)).toEqual(points);
  });

  // reject incomplete pairs, extra fields, and coordinates outside the ferry region
  it.each([
    {},
    null,
    [],
    { booth },
    { booth, dock, extra: true },
    { booth: undefined, dock },
    { booth: { latitude: 47 }, dock },
    { booth: { ...booth, latitude: NaN }, dock },
    { booth: { ...booth, longitude: Infinity }, dock },
    { booth: { ...booth, latitude: 90 }, dock },
    { booth: { ...booth, longitude: -118 }, dock },
    { booth: { ...booth, latitude: "47" }, dock },
    { booth: { ...booth, providerMetadata: "unexpected" }, dock },
  ])("rejects unsafe point payloads %j", (points) => {
    expect(parseTerminalLocations(points)).toBeNull();
  });

  // list all terminals without pretending the upstream center is a booth
  it("separates editable points from the default dock", async () => {
    const { store, service } = makeFixture();
    vi.mocked(store.list).mockResolvedValue([]);
    expect(await service.list()).toEqual({
      terminals: [
        {
          terminalId: "7",
          name: "Seattle",
          abbreviation: "SEA",
          defaultDock: { latitude: 47.6, longitude: -122.33 },
          booth: null,
          dock: null,
          updatedAt: null,
        },
      ],
    });
  });

  // write both points atomically without altering raw terminal coordinates
  it("persists a replacement and reports the saved timestamp", async () => {
    const { store, service } = makeFixture();
    expect(await service.save("7", { booth, dock })).toMatchObject({
      booth,
      dock,
      updatedAt: "2026-10-03T12:00:00.000Z",
    });
    expect(store.save).toHaveBeenCalledWith("7", { booth, dock });
    expect(terminal.location.latitude).toBe(47.6);
  });

  // unknown ids and malformed points never reach persistence
  it("rejects unknown and unavailable terminals before saving", async () => {
    const { store, getTerminals, service } = makeFixture();
    await expect(service.save("unknown", { booth, dock })).rejects.toThrow(
      "Invalid terminal locations"
    );
    await expect(service.save("7", { booth })).rejects.toThrow(
      "Invalid terminal locations"
    );
    getTerminals.mockResolvedValue([]);
    await expect(service.save("7", { booth, dock })).rejects.toThrow(
      "Terminal unavailable"
    );
    expect(store.save).not.toHaveBeenCalled();
  });

  // query the durable booth every time instead of retaining process-local overrides
  it("reads fresh booths and never falls back to docks", async () => {
    const { store, service } = makeFixture();
    expect(await service.getBooth("7")).toEqual(booth);
    vi.mocked(store.read).mockResolvedValue({
      terminalId: "7",
      booth: null,
      dock,
      updatedAt: new Date(),
    });
    expect(await service.getBooth("7")).toBeNull();
    vi.mocked(store.read).mockResolvedValue(null);
    expect(await service.getBooth("7")).toBeNull();
    expect(store.read).toHaveBeenCalledTimes(3);
  });

  // disclose docks but not booth positions or owner metadata in public projections
  it("overlays terminal and mate docks without mutating upstream data", async () => {
    const { service } = makeFixture();
    const mate = { ...terminal, id: "3" };
    const source = { ...terminal, mates: [mate] };
    const mateDock = { latitude: 47.62, longitude: -122.51 };
    const result = applyTerminalDocks(source, {
      ...(await service.getDocks()),
      "3": mateDock,
    });
    expect(result.location).toEqual({ ...source.location, ...dock });
    expect(result.mates?.[0].location).toEqual({
      ...mate.location,
      ...mateDock,
    });
    expect(source.location.latitude).toBe(47.6);
    expect(mate.location.latitude).toBe(47.6);
    expect(result).not.toHaveProperty("booth");
    expect(result).not.toHaveProperty("updatedAt");
  });
});
