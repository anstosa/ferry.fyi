import { describe, expect, it } from "vitest";

import { Vessel } from "../../server/models/Vessel";

// public vessel boundary
describe("vessel serialization", () => {
  // nullish upstream fields
  it("omits optional WSF fields when hydrated cache values are null", () => {
    const vessel = new Vessel({
      abbreviation: "WEN",
      arrivingTerminalId: null,
      gpsDelay: {
        confidence: "low",
        delaySeconds: 0,
        explanation: "limited signal",
        signals: {
          dockDelaySeconds: null,
          etaDelaySeconds: null,
          progress: 0,
          scheduledArrivalTime: 1,
          scheduledDepartureTime: 0,
        },
        source: "gps",
      },
      id: "33",
      info: { ada: null, crossing: null },
      yearRebuilt: null,
    });

    const serialized = vessel.serialize();
    const jsonReady = JSON.parse(JSON.stringify(serialized));

    expect(jsonReady).not.toHaveProperty("arrivingTerminalId");
    expect(jsonReady.info).not.toHaveProperty("ada");
    expect(jsonReady.info).not.toHaveProperty("crossing");
    expect(jsonReady).not.toHaveProperty("yearRebuilt");
    expect(jsonReady.gpsDelay.signals).toMatchObject({
      dockDelaySeconds: null,
      etaDelaySeconds: null,
    });
  });

  // valid upstream fields
  it("preserves contract-conforming optional WSF values", () => {
    const vessel = new Vessel({
      abbreviation: "WEN",
      arrivingTerminalId: 7,
      id: "33",
      info: { ada: "accessible", crossing: "GPS" },
      yearRebuilt: 2004,
    });

    expect(vessel.serialize()).toMatchObject({
      arrivingTerminalId: 7,
      info: { ada: "accessible", crossing: "GPS" },
      yearRebuilt: 2004,
    });
  });
});
