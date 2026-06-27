import type { Terminal } from "shared/contracts/terminals";
import type { Vessel } from "shared/contracts/vessels";
import { describe, expect, it } from "vitest";

import {
  getArrivedSailing,
  getEstimatedDepartureMinutes,
  getOnboardSailing,
  getProjectedSailingProgress,
  getTrackedSailing,
  projectPointToRoute,
} from "../../client/lib/onboardSailing";

// build terminal fixture
const makeTerminal = (id: string, name: string, longitude: number): Terminal =>
  ({
    id,
    location: { address: {}, latitude: 0, longitude },
    name,
  }) as Terminal;

const departureTerminal = makeTerminal("1", "Departure", 0);
const destinationTerminal = makeTerminal("2", "Destination", 1);
const terminals = [departureTerminal, destinationTerminal];

// build vessel fixture
const makeVessel = (input: Partial<Vessel> = {}): Vessel =>
  ({
    arrivingTerminalId: 2,
    departingTerminalId: 1,
    gpsDelay: {
      confidence: "high",
      delaySeconds: 10 * 60,
      explanation: "GPS fixture",
      signals: {
        dockDelaySeconds: null,
        etaDelaySeconds: null,
        progress: 0.5,
        scheduledArrivalTime: 2200,
        scheduledDepartureTime: 1000,
      },
      source: "gps",
    },
    id: "vessel",
    isAtDock: false,
    location: { latitude: 0, longitude: 0.5 },
    name: "Test Ferry",
    speed: 12,
    ...input,
  }) as Vessel;

// onboard sailing fixture
const getMatch = (input: Partial<Vessel> = {}) =>
  getOnboardSailing({
    terminals,
    userLocation: { latitude: 0, longitude: 0.5 },
    vessels: [makeVessel(input)],
  });

describe("onboard sailing detection", () => {
  // route projection
  it("projects progress and route distance for a user location", () => {
    const projection = projectPointToRoute(
      departureTerminal.location,
      destinationTerminal.location,
      { latitude: 0, longitude: 0.25 }
    );

    expect(projection?.progress).toBe(0.25);
    expect(projection?.distanceFromRoute).toBe(0);
  });

  // onboard match
  it("matches the nearby moving GPS ferry and computes ETA", () => {
    const match = getMatch();

    expect(match?.vessel.name).toBe("Test Ferry");
    expect(match?.departureTerminal.name).toBe("Departure");
    expect(match?.destinationTerminal.name).toBe("Destination");
    expect(match?.progress).toBe(0.5);
    expect(match?.etaMinutes).toBe(10);
  });

  // delay-independent onboard eta
  it("uses remaining crossing progress for ETA instead of delay", () => {
    const match = getOnboardSailing({
      simulatedVesselId: "vessel",
      terminals,
      userLocation: null,
      vessels: [
        makeVessel({
          gpsDelay: {
            ...makeVessel().gpsDelay!,
            delaySeconds: 9 * 60,
            signals: {
              ...makeVessel().gpsDelay!.signals,
              progress: 0.5,
              scheduledArrivalTime: 2200,
              scheduledDepartureTime: 1000,
            },
          },
        }),
      ],
    });

    expect(match?.etaMinutes).toBe(10);
  });

  // dock proximity guard
  it("does not match a vessel still effectively at the dock", () => {
    const match = getOnboardSailing({
      terminals,
      userLocation: { latitude: 0, longitude: 0.01 },
      vessels: [
        makeVessel({
          gpsDelay: {
            ...makeVessel().gpsDelay!,
            signals: { ...makeVessel().gpsDelay!.signals, progress: 0.01 },
          },
          location: { latitude: 0, longitude: 0.01 },
        }),
      ],
    });

    expect(match).toBeNull();
  });

  // simulated location bypass
  it("uses a simulated vessel without user location", () => {
    const match = getOnboardSailing({
      simulatedVesselId: "vessel",
      terminals,
      userLocation: null,
      vessels: [makeVessel()],
    });

    expect(match?.vessel.id).toBe("vessel");
    expect(match?.distanceMiles).toBe(0);
    expect(match?.etaMinutes).toBe(10);
  });

  // tracked boat match
  it("tracks a requested moving GPS ferry without user location", () => {
    const match = getTrackedSailing({
      terminals,
      vesselId: "vessel",
      vessels: [makeVessel()],
    });

    expect(match?.vessel.id).toBe("vessel");
    expect(match?.departureTerminal.name).toBe("Departure");
    expect(match?.destinationTerminal.name).toBe("Destination");
    expect(match?.etaMinutes).toBe(10);
  });

  // tracked docked boat
  it("tracks a requested docked ferry with live route context", () => {
    const match = getTrackedSailing({
      terminals,
      vesselId: "vessel",
      vessels: [
        makeVessel({
          isAtDock: true,
          speed: 0,
        }),
      ],
    });

    expect(match?.vessel.isAtDock).toBe(true);
    expect(match?.departureTerminal.name).toBe("Departure");
    expect(match?.destinationTerminal.name).toBe("Destination");
  });

  // tracked dock approach
  it("tracks a requested ferry while approaching the destination", () => {
    const match = getTrackedSailing({
      terminals,
      vesselId: "vessel",
      vessels: [
        makeVessel({
          gpsDelay: {
            ...makeVessel().gpsDelay!,
            signals: {
              ...makeVessel().gpsDelay!.signals,
              progress: 0.99,
            },
          },
        }),
      ],
    });

    expect(match?.progress).toBe(0.99);
    expect(match?.etaMinutes).toBe(1);
  });

  // estimated departure countdown
  it("estimates docked tracked vessel departure from GPS delay", () => {
    const match = getTrackedSailing({
      terminals,
      vesselId: "vessel",
      vessels: [
        makeVessel({
          gpsDelay: {
            ...makeVessel().gpsDelay!,
            delaySeconds: 120,
            signals: {
              ...makeVessel().gpsDelay!.signals,
              scheduledDepartureTime: 1000,
            },
          },
          isAtDock: true,
          speed: 0,
        }),
      ],
    });

    expect(match).not.toBeNull();
    expect(getEstimatedDepartureMinutes(match!, 940)).toBe(3);
  });

  // projected animation progress
  it("projects progress forward from GPS delay timing", () => {
    const match = getOnboardSailing({
      simulatedVesselId: "vessel",
      terminals,
      userLocation: null,
      vessels: [
        makeVessel({
          gpsDelay: {
            ...makeVessel().gpsDelay!,
            delaySeconds: 120,
            signals: {
              ...makeVessel().gpsDelay!.signals,
              progress: 0.4,
              scheduledArrivalTime: 1600,
              scheduledDepartureTime: 1000,
            },
          },
        }),
      ],
    });

    expect(match).not.toBeNull();
    expect(getProjectedSailingProgress(match!, 1420)).toBe(0.5);
  });

  // arrival grace period
  it("keeps a docked destination sailing visible during arrival grace", () => {
    const previousSailing = getMatch();

    expect(previousSailing).not.toBeNull();

    const arrivedSailing = getArrivedSailing({
      now: 10_000,
      previousSailing: previousSailing!,
      vessels: [
        makeVessel({
          arrivingTerminalId: undefined,
          departingTerminalId: 2,
          dockedTime: 9_500_000,
          isAtDock: true,
          location: destinationTerminal.location,
          speed: 0,
        }),
      ],
    });

    expect(arrivedSailing?.etaMinutes).toBe(0);
    expect(arrivedSailing?.progress).toBe(1);
    expect(arrivedSailing?.vessel.isAtDock).toBe(true);
  });

  // expired arrival grace
  it("hides a docked destination sailing after arrival grace", () => {
    const previousSailing = getMatch();

    expect(previousSailing).not.toBeNull();

    const arrivedSailing = getArrivedSailing({
      now: 10_000,
      previousSailing: previousSailing!,
      vessels: [
        makeVessel({
          departingTerminalId: 2,
          dockedTime: 9_000,
          isAtDock: true,
          location: destinationTerminal.location,
          speed: 0,
        }),
      ],
    });

    expect(arrivedSailing).toBeNull();
  });

  // wrong-dock guard
  it("does not keep a docked sailing visible at the wrong terminal", () => {
    const previousSailing = getMatch();

    expect(previousSailing).not.toBeNull();

    const arrivedSailing = getArrivedSailing({
      now: 10_000,
      previousSailing: previousSailing!,
      vessels: [
        makeVessel({
          arrivingTerminalId: undefined,
          departingTerminalId: 1,
          dockedTime: 9_500,
          isAtDock: true,
          location: departureTerminal.location,
          speed: 0,
        }),
      ],
    });

    expect(arrivedSailing).toBeNull();
  });

  // stale/non-moving guard
  it("requires a live moving GPS delay signal", () => {
    expect(getMatch({ gpsDelay: undefined })).toBeNull();
    expect(getMatch({ isAtDock: true })).toBeNull();
    expect(getMatch({ speed: 0 })).toBeNull();
  });

  // nearest boat guard
  it("chooses the closest matching vessel", () => {
    const match = getOnboardSailing({
      terminals,
      userLocation: { latitude: 0, longitude: 0.5 },
      vessels: [
        makeVessel({
          id: "far",
          location: { latitude: 0, longitude: 0.505 },
          name: "Far Ferry",
        }),
        makeVessel({
          id: "near",
          location: { latitude: 0, longitude: 0.5 },
          name: "Near Ferry",
        }),
      ],
    });

    expect(match?.vessel.id).toBe("near");
  });
});
