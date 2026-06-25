import { describe, expect, it } from "vitest";

import terminalOverrides from "../../shared/data/terminals.json";
import wsfCore from "../../shared/data/wsf-core.json";

// terminal route data
describe("terminal route data", () => {
  // sidney removal
  it("does not expose the retired Sidney terminal", () => {
    expect(wsfCore.terminals).not.toHaveProperty("19");
    expect(terminalOverrides).not.toHaveProperty("19");
  });

  // sidney route removal
  it("does not include Sidney in any static route", () => {
    Object.values(wsfCore.routes).forEach((route) => {
      // retired terminal guard
      expect(route.terminalIds).not.toContain("19");
    });
  });

  // route capacity metadata
  it("keeps average vehicle capacities for camera sailing estimates", () => {
    Object.values(wsfCore.routes).forEach((route) => {
      // capacity guard
      expect(route.averageVehicleCapacity).toBeGreaterThan(0);
    });
  });
});
