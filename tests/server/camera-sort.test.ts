import { describe, expect, it } from "vitest";

import { Camera } from "../../server/models/Camera";

// camera display order
describe("Camera.sortByTerminalDisplayOrder", () => {
  // dock priority
  it("places dock cameras before lower-numbered queue cameras", () => {
    const cameras = [
      { id: "holding", orderFromTerminal: 0, title: "Holding" },
      { id: "dock", orderFromTerminal: 99, title: "Dock" },
      { id: "uphill", orderFromTerminal: 1, title: "Uphill" },
    ] as unknown as Camera[];

    const sortedIds = Camera.sortByTerminalDisplayOrder(cameras).map(
      ({ id }) => {
        // expose sort result
        return id;
      }
    );

    expect(sortedIds).toEqual(["dock", "holding", "uphill"]);
  });
});
