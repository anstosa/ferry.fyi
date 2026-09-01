import { describe, expect, it, vi } from "vitest";

vi.mock("~/models/Crossing", () => ({ default: class Crossing {} }));

const { toPublicSchedule } =
  await import("../../server/lib/publicScheduleProjection");
const { Schedule } = await import("../../server/models/Schedule");

const scheduleInput = {
  date: "2026-08-31",
  internalScheduleField: "private",
  key: "5-14-2026-08-31",
  mateId: "14",
  slots: [
    {
      allowsPassengers: true,
      allowsVehicles: true,
      crossing: {
        arrivalId: "14",
        capacityReportingStartedAt: 1_788_200_000,
        capacityReportUpdatedAt: 1_788_200_100,
        createdAt: "private",
        departureDelta: null,
        departureId: "5",
        departureTime: 1_788_200_200,
        driveUpCapacity: 9,
        hasDriveUp: true,
        hasReservations: false,
        id: 91,
        isCancelled: false,
        reservableCapacity: 0,
        totalCapacity: 120,
        updatedAt: "private",
        vesselId: "22",
        vesselName: "Suquamish",
      },
      estimate: {
        confidence: "high",
        driveUpCapacity: 5,
        factors: [
          {
            detail: "Heavy recent demand",
            impact: "higher",
            internalFactorField: "private",
            label: "Recent route demand",
          },
        ],
        fullProbability: 0.82,
        fullRisk: "high",
        internalEstimateField: "private",
        reservableCapacity: 0,
        routeClass: "standard",
        sampleSize: 20,
        source: "historical",
      },
      hasPassed: false,
      internalSlotField: "private",
      mateId: "14",
      time: 1_788_200_200,
      vessel: {
        abbreviation: "SUQ",
        id: "22",
        internalVesselField: "private",
        isAtDock: true,
        name: "Suquamish",
        scheduledDepartureTime: 1_788_200_200,
        speed: 18,
        tallVehicleCapacity: 60,
        vehicleCapacity: 120,
        vesselWatchUrl: "https://example.test/vessel",
      },
      vesselPosition: 1,
      wuid: "Mon-08-00",
    },
  ],
  sourceUpdatedAt: 1_788_200_100,
  terminalId: "5",
  validRange: null,
};

describe("public schedule projection", () => {
  // prove recursive allow-list ownership
  it("removes private model and forecast fields recursively", () => {
    const result = toPublicSchedule(scheduleInput as never);
    const serialized = JSON.stringify(result);

    expect(result.slots[0].crossing).toEqual({
      arrivalId: "14",
      capacityReportUpdatedAt: 1_788_200_100,
      departureDelta: null,
      departureId: "5",
      departureTime: 1_788_200_200,
      driveUpCapacity: 9,
      hasDriveUp: true,
      hasReservations: false,
      isCancelled: false,
      reservableCapacity: 0,
      totalCapacity: 120,
      vesselId: "22",
      vesselName: "Suquamish",
    });
    expect(result.slots[0].estimate?.factors?.[0]).toEqual({
      detail: "Heavy recent demand",
      impact: "higher",
      label: "Recent route demand",
    });
    expect(serialized).not.toContain("capacityReportingStartedAt");
    expect(serialized).not.toContain("internal");
    expect(serialized).not.toContain("createdAt");
    expect(serialized).not.toContain("updatedAt");
  });

  // prove the cached model uses the same owner
  it("routes Schedule.serialize through the public projection", () => {
    const result = Schedule.prototype.serialize.call(scheduleInput);
    const serialized = JSON.stringify(result);

    expect(result).toEqual(toPublicSchedule(scheduleInput as never));
    expect(serialized).not.toContain("capacityReportingStartedAt");
  });
});
