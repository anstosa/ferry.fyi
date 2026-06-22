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
});
