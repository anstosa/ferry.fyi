import { beforeEach, describe, expect, it, vi } from "vitest";

const wsfRequest = vi.hoisted(() => vi.fn());

vi.mock("~/lib/logger", () => ({
  default: { error: vi.fn(), info: vi.fn() },
}));

vi.mock("~/lib/wsf/api", () => ({
  wsfRequest,
}));

import { updateVessels } from "~/lib/wsf/updateVessels";
import { Vessel } from "~/models/Vessel";

// vessel fixture
const makeVessel = (
  VesselID: number,
  VesselName: string,
  PublicWifi: boolean
) =>
  ({
    ADAAccessible: true,
    Beam: "64",
    CarDeckRestroom: true,
    Class: { ClassID: 7 },
    Elevator: true,
    Horsepower: 6000,
    Length: "362",
    MainCabinGalley: true,
    MainCabinRestroom: true,
    MaxPassengerCount: 1500,
    PublicWifi,
    RegDeckSpace: 124,
    SpeedInKnots: 18,
    Status: 1,
    TallDeckClearance: 15,
    TallDeckSpace: 20,
    Tonnage: 4000,
    VesselAbbrev: VesselName.slice(0, 3).toUpperCase(),
    VesselID,
    VesselName,
    YearBuilt: 2017,
    YearRebuilt: 0,
  }) as any;

describe("vessel overrides", () => {
  beforeEach(() => {
    Vessel.purge();
    wsfRequest.mockReset();
  });

  it("overrides Chimacum Wi-Fi on when WSF reports it off", async () => {
    wsfRequest
      .mockResolvedValueOnce("/Date(1781907800000-0700)/")
      .mockResolvedValueOnce([makeVessel(74, "Chimacum", false)]);

    await updateVessels();

    expect(Vessel.getByIndex("74")?.hasWiFi).toBe(true);
  });
});
