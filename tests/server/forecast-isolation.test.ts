import { beforeEach, describe, expect, it, vi } from "vitest";

const forecastModel = vi.hoisted(() => ({ updateEstimates: vi.fn() }));

vi.mock("../../server/lib/forecast", () => forecastModel);

const {
  applyForecastSnapshots,
  serializeForecastSchedules,
  updateEstimatesIsolated,
} = await import("../../server/lib/forecastIsolation");

describe("forecast isolation", () => {
  // reset forecast mocks
  beforeEach(() => {
    forecastModel.updateEstimates.mockReset();
    forecastModel.updateEstimates.mockResolvedValue(undefined);
  });

  // preserve the private worker payload
  it("serializes cached schedules without using the public serializer", () => {
    const serialize = vi.fn(() => {
      throw new Error("public serializer must not serve the worker");
    });
    const schedule = {
      date: "2026-08-26",
      key: "5-14-2026-08-26",
      mateId: "14",
      serialize,
      slots: [
        {
          allowsPassengers: true,
          allowsVehicles: true,
          crossing: {
            arrivalId: "14",
            capacityReportingStartedAt: 99,
            capacityReportUpdatedAt: 100,
            departureDelta: null,
            departureId: "5",
            departureTime: 123,
            driveUpCapacity: 120,
            hasDriveUp: true,
            hasReservations: false,
            isCancelled: false,
            reservableCapacity: 0,
            totalCapacity: 120,
            vesselId: null,
            vesselName: null,
          },
          hasPassed: false,
          mateId: "14",
          time: 123,
          vessel: {
            abbreviation: "SUQ",
            // model-owned enumerable method
            getIndex: vi.fn(),
            id: "22",
            name: "Suquamish",
            speed: 18,
            tallVehicleCapacity: 60,
            vehicleCapacity: 120,
            vesselWatchUrl: "https://example.test/vessel",
          },
          wuid: "Wed-08-00",
        },
      ],
      terminalId: "5",
      validRange: null,
    } as never;

    const result = serializeForecastSchedules([schedule]);

    expect(serialize).not.toHaveBeenCalled();
    expect(result).toEqual([
      expect.objectContaining({
        key: "5-14-2026-08-26",
        slots: [
          expect.objectContaining({
            crossing: expect.objectContaining({
              capacityReportingStartedAt: 99,
            }),
            time: 123,
          }),
        ],
      }),
    ]);
    expect(structuredClone(result)).toEqual(result);
  });

  // normalize mixed-version private state
  it.each([undefined, null])(
    "normalizes %s reporting-start state to null",
    (capacityReportingStartedAt) => {
      const schedule = {
        date: "2026-08-26",
        key: "5-14-2026-08-26",
        mateId: "14",
        slots: [
          {
            allowsPassengers: true,
            allowsVehicles: true,
            crossing: {
              arrivalId: "14",
              capacityReportingStartedAt,
              departureDelta: null,
              departureId: "5",
              departureTime: 123,
              driveUpCapacity: 120,
              hasDriveUp: true,
              hasReservations: false,
              isCancelled: false,
              reservableCapacity: 0,
              totalCapacity: 120,
            },
            hasPassed: false,
            mateId: "14",
            time: 123,
            vessel: {
              abbreviation: "SUQ",
              id: "22",
              name: "Suquamish",
              speed: 18,
              tallVehicleCapacity: 60,
              vehicleCapacity: 120,
              vesselWatchUrl: "https://example.test/vessel",
            },
            wuid: "Wed-08-00",
          },
        ],
        terminalId: "5",
        validRange: null,
      } as never;

      expect(
        serializeForecastSchedules([schedule])[0].slots[0].crossing
          ?.capacityReportingStartedAt
      ).toBeNull();
    }
  );

  // merge results by stable identities
  it("applies only matching schedule and sailing snapshots", () => {
    const matchingSlot = { time: 123 };
    const staleSlot = { time: 456, weather: { existing: true } };
    const schedule = {
      key: "5-14-2026-08-26",
      slots: [matchingSlot, staleSlot],
    } as never;
    const estimate = {
      driveUpCapacity: 20,
      reservableCapacity: 0,
    };

    applyForecastSnapshots(
      [schedule],
      [
        {
          key: "5-14-2026-08-26",
          slots: [{ estimate, time: 123 }],
        },
        {
          key: "stale-schedule",
          slots: [{ estimate, time: 456 }],
        },
      ]
    );

    expect(matchingSlot).toEqual(
      expect.objectContaining({ estimate, tide: undefined, weather: undefined })
    );
    expect(staleSlot).toEqual({ time: 456, weather: { existing: true } });
  });

  // forecast revision marker
  it("marks the source revision after isolated forecasts finish", async () => {
    const schedule = {
      forecastSourceUpdatedAt: null,
      sourceUpdatedAt: 100,
    };

    await updateEstimatesIsolated([schedule as never]);

    expect(forecastModel.updateEstimates).toHaveBeenCalledWith([schedule]);
    expect(schedule.forecastSourceUpdatedAt).toBe(100);
  });

  // stale forecast revision marker
  it("does not mark a schedule revision that changed during forecasting", async () => {
    const schedule = {
      forecastSourceUpdatedAt: null,
      sourceUpdatedAt: 100,
    };
    forecastModel.updateEstimates.mockImplementation(() => {
      // simulate a concurrent schedule refresh
      schedule.sourceUpdatedAt = 101;
    });

    await updateEstimatesIsolated([schedule as never]);

    expect(schedule.forecastSourceUpdatedAt).toBeNull();
  });
});
