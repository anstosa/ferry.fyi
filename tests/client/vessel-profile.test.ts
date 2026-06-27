import type { Vessel } from "shared/contracts/vessels";
import { describe, expect, it } from "vitest";

import { getVesselProfileStats } from "../../client/views/Schedule/vesselProfile";

describe("vessel profile stats", () => {
  // historical vessel fallback
  it("handles historical placeholder vessels without full metadata", () => {
    const stats = getVesselProfileStats({
      abbreviation: "Hist",
      id: "historical",
      name: "Historical sailing",
      speed: 0,
      tallVehicleCapacity: 0,
      vehicleCapacity: 139,
      vesselWatchUrl: "",
    } as Vessel);

    expect(stats).toMatchObject({
      passengerCapacityLabel: "Unknown",
      regularVehicleCapacity: 139,
      tallVehicleCapacity: 0,
      vehicleCapacity: 139,
      vesselClassLabel: "Unknown",
    });
  });

  // class asset fallback
  it("prefers asset class names and keeps build years", () => {
    const stats = getVesselProfileStats(
      {
        classId: "Jumbo Mark II",
        passengerCapacity: 2500,
        tallVehicleCapacity: 20,
        vehicleCapacity: 200,
        yearBuilt: 1997,
      } as Vessel,
      "Olympic"
    );

    expect(stats).toMatchObject({
      passengerCapacityLabel: "2,500",
      regularVehicleCapacity: 180,
      vesselClassLabel: "Olympic (1997)",
    });
  });
});
