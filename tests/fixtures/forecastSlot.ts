import type { ForecastFullRisk, Slot } from "shared/contracts/schedules";

// build one forecast sailing
export const createForecastSlot = ({
  fullRisk,
  spacesLeft,
  withLiveCapacity = false,
}: {
  fullRisk: ForecastFullRisk;
  spacesLeft: number;
  withLiveCapacity?: boolean;
}): Slot => ({
  allowsPassengers: true,
  allowsVehicles: true,
  // optional live capacity
  crossing: withLiveCapacity
    ? {
        arrivalId: "arrival",
        departureDelta: null,
        departureId: "departure",
        departureTime: 2_000_000_000,
        driveUpCapacity: 30,
        hasDriveUp: true,
        hasReservations: false,
        isCancelled: false,
        reservableCapacity: 0,
        totalCapacity: 141,
      }
    : undefined,
  estimate: {
    confidence: "high",
    driveUpCapacity: spacesLeft,
    factors: [],
    // forecast risk probability
    fullProbability: fullRisk === "likely" ? 0.6 : 0.34,
    fullRisk,
    reservableCapacity: 0,
  },
  hasPassed: false,
  mateId: "14",
  time: 2_000_000_000,
  vessel: {
    abbreviation: "TEST",
    beam: "80 ft",
    classId: "test",
    hasCarDeckRestroom: true,
    hasElevator: true,
    hasGalley: false,
    hasRestroom: true,
    hasWiFi: false,
    horsepower: 1,
    id: "test-vessel",
    inMaintenance: false,
    inService: true,
    info: {},
    isAdaAccessible: true,
    maxClearance: 15,
    name: "Test Vessel",
    passengerCapacity: 1_000,
    speed: 0,
    tallVehicleCapacity: 0,
    vehicleCapacity: 141,
    vesselWatchUrl: "",
    weight: 1,
    yearBuilt: 2000,
  },
  wuid: `test-${fullRisk}-${spacesLeft}-${withLiveCapacity}`,
});
