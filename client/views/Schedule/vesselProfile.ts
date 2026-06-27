import type { Vessel } from "shared/contracts/vessels";

export interface VesselProfileStats {
  passengerCapacityLabel: string;
  regularVehicleCapacity: number;
  tallVehicleCapacity: number;
  vehicleCapacity: number;
  vesselClassLabel: string;
}

// build vessel profile labels
export const getVesselProfileStats = (
  vessel: Vessel,
  assetClassName?: string
): VesselProfileStats => {
  const passengerCapacity = vessel.passengerCapacity ?? NaN;
  const tallVehicleCapacity = vessel.tallVehicleCapacity ?? 0;
  const vehicleCapacity = vessel.vehicleCapacity ?? 0;
  const vesselClassName = assetClassName ?? vessel.classId;
  // passenger fallback
  const passengerCapacityLabel = Number.isFinite(passengerCapacity)
    ? passengerCapacity.toLocaleString()
    : "Unknown";
  // class fallback
  const vesselClassLabel = vessel.yearBuilt
    ? `${vesselClassName || "Unknown"} (${vessel.yearBuilt})`
    : vesselClassName || "Unknown";

  return {
    passengerCapacityLabel,
    regularVehicleCapacity: vehicleCapacity - tallVehicleCapacity,
    tallVehicleCapacity,
    vehicleCapacity,
    vesselClassLabel,
  };
};
