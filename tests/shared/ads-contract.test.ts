import { describe, expect, it } from "vitest";

import {
  AD_SLOT_IDS,
  getAdPlacementKey,
  parseAdPlacementKey,
} from "../../shared/contracts/ads";

describe("ad contracts", () => {
  it("defines the supported slots and stable global placement keys", () => {
    expect(AD_SLOT_IDS).toEqual([
      "home",
      "schedule",
      "cameras",
      "terminal",
      "fare",
    ]);
    expect(
      getAdPlacementKey({
        arrivalTerminalId: null,
        departureTerminalId: null,
        slot: "home",
      })
    ).toBe("home");
  });

  it("keeps opposite route directions in distinct safe keys", () => {
    expect(
      getAdPlacementKey({
        arrivalTerminalId: "7",
        departureTerminalId: "3",
        slot: "schedule",
      })
    ).toBe("schedule--3--7");
    expect(
      getAdPlacementKey({
        arrivalTerminalId: "3",
        departureTerminalId: "7",
        slot: "schedule",
      })
    ).toBe("schedule--7--3");
  });

  it("rejects partial and unsafe route directions", () => {
    expect(() =>
      getAdPlacementKey({
        arrivalTerminalId: null,
        departureTerminalId: "3",
        slot: "fare",
      })
    ).toThrow("Invalid ad placement direction");
    expect(() =>
      getAdPlacementKey({
        arrivalTerminalId: "some/id",
        departureTerminalId: "3",
        slot: "fare",
      })
    ).toThrow("Invalid ad placement direction");
    expect(() =>
      getAdPlacementKey({
        arrivalTerminalId: null,
        departureTerminalId: null,
        slot: "schedule",
      })
    ).toThrow("Invalid ad placement direction");
    expect(() =>
      getAdPlacementKey({
        arrivalTerminalId: "7",
        departureTerminalId: "3",
        slot: "home",
      })
    ).toThrow("Invalid ad placement direction");
  });

  it("accepts only route directions in the canonical catalog", () => {
    expect(parseAdPlacementKey("schedule--3--7")).toEqual({
      arrivalTerminalId: "7",
      departureTerminalId: "3",
      slot: "schedule",
    });
    expect(parseAdPlacementKey("home")).toEqual({
      arrivalTerminalId: null,
      departureTerminalId: null,
      slot: "home",
    });
    expect(parseAdPlacementKey("schedule--3--9999")).toBeNull();
    expect(parseAdPlacementKey("schedule--3--3")).toBeNull();
  });
});
