import { describe, expect, it } from "vitest";

import {
  calculateGpsDelay,
  calculateGpsDelayForLeg,
  findGpsDelayLeg,
} from "../../server/lib/wsf/gpsDelay";

const departureLocation = { latitude: 47, longitude: -122 };
const arrivalLocation = { latitude: 48, longitude: -122 };

// route point fixture
const routePoint = (
  progress: number
): { latitude: number; longitude: number } => ({
  latitude:
    departureLocation.latitude +
    (arrivalLocation.latitude - departureLocation.latitude) * progress,
  longitude: -122,
});

describe("GPS delay calculation", () => {
  // disagreement case
  it("uses GPS progress as the primary delay when ETA and dock signals disagree", () => {
    const result = calculateGpsDelay({
      arrivalLocation,
      departureLocation,
      dockDelaySeconds: 8 * 60,
      etaDelaySeconds: 4 * 60,
      now: 62 * 60,
      scheduledArrivalTime: 100 * 60,
      scheduledDepartureTime: 0,
      vesselLocation: routePoint(0.5),
    });

    expect(result).toMatchObject({
      confidence: "high",
      delaySeconds: 12 * 60,
      signals: {
        dockDelaySeconds: 8 * 60,
        etaDelaySeconds: 4 * 60,
        progress: 0.5,
      },
      source: "gps",
    });
  });

  // active leg matching
  it("matches active scheduled leg data for the vessel route", () => {
    const leg = findGpsDelayLeg({
      arrivalTerminalId: "2",
      departureTerminalId: "1",
      scheduledDepartureTime: 10 * 60,
      schedules: [
        {
          mateId: "2",
          slots: [
            { arrivalTime: 70 * 60, time: 10 * 60, vessel: { id: "vessel" } },
          ],
          terminalId: "1",
        },
      ],
      terminals: [
        { id: "1", location: departureLocation },
        { id: "2", location: arrivalLocation },
      ],
      vesselId: "vessel",
    });

    expect(leg).toMatchObject({
      arrivalLocation,
      departureLocation,
      scheduledArrivalTime: 70 * 60,
      scheduledDepartureTime: 10 * 60,
    });
    expect(
      calculateGpsDelayForLeg({
        leg: leg!,
        now: 46 * 60,
        vesselLocation: routePoint(0.5),
      })
    ).toMatchObject({ delaySeconds: 6 * 60, source: "gps" });
  });

  // duplicate schedule matching
  it("matches the nearest vessel slot across duplicate route schedules", () => {
    const leg = findGpsDelayLeg({
      arrivalTerminalId: "2",
      departureTerminalId: "1",
      scheduledDepartureTime: 10 * 60,
      schedules: [
        {
          mateId: "2",
          slots: [
            { arrivalTime: 400 * 60, time: 300 * 60, vessel: { id: "vessel" } },
          ],
          terminalId: "1",
        },
        {
          mateId: "2",
          slots: [
            { arrivalTime: 70 * 60, time: 10 * 60, vessel: { id: "vessel" } },
          ],
          terminalId: "1",
        },
      ],
      terminals: [
        { id: "1", location: departureLocation },
        { id: "2", location: arrivalLocation },
      ],
      vesselId: "vessel",
    });

    expect(leg).toMatchObject({
      scheduledArrivalTime: 70 * 60,
      scheduledDepartureTime: 10 * 60,
    });
  });

  // missing active leg case
  it("falls back when active scheduled leg data is unavailable", () => {
    expect(
      findGpsDelayLeg({
        arrivalTerminalId: "2",
        departureTerminalId: "1",
        scheduledDepartureTime: 10 * 60,
        schedules: [],
        terminals: [
          { id: "1", location: departureLocation },
          { id: "2", location: arrivalLocation },
        ],
        vesselId: "vessel",
      })
    ).toBeNull();
  });

  // missing GPS case
  it("falls back when GPS or route endpoints are unavailable", () => {
    expect(
      calculateGpsDelay({
        arrivalLocation,
        departureLocation,
        now: 62 * 60,
        scheduledArrivalTime: 100 * 60,
        scheduledDepartureTime: 0,
        vesselLocation: null,
      })
    ).toBeNull();
  });

  // route boundary case
  it("clamps progress to the scheduled route endpoints", () => {
    const result = calculateGpsDelay({
      arrivalLocation,
      departureLocation,
      now: 110 * 60,
      scheduledArrivalTime: 100 * 60,
      scheduledDepartureTime: 0,
      vesselLocation: routePoint(1.2),
    });

    expect(result).toMatchObject({
      delaySeconds: 10 * 60,
      signals: { progress: 1 },
      source: "gps",
    });
  });
});
