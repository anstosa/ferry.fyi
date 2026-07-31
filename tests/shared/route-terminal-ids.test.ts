import { describe, expect, it } from "vitest";

import routeTerminalIds from "../../shared/data/route-terminal-ids.json";
import wsfCore from "../../shared/data/wsf-core.json";

describe("compact route topology", () => {
  it("matches the canonical WSF route terminal ids", () => {
    expect(routeTerminalIds).toEqual(
      Object.fromEntries(
        Object.entries(wsfCore.routes).map(([id, route]) => [
          id,
          { terminalIds: route.terminalIds },
        ])
      )
    );
  });
});
