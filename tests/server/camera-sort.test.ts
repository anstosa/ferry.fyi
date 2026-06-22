import { describe, expect, it } from "vitest";

import { Camera } from "../../server/models/Camera";

// camera display order
describe("Camera.sortByTerminalDisplayOrder", () => {
  // explicit order priority
  it("uses metadata order instead of dock title text", () => {
    const cameras = [
      { id: "holding", orderFromTerminal: 1, title: "Holding" },
      { id: "dock", orderFromTerminal: 99, title: "Dock" },
      { id: "uphill", orderFromTerminal: 2, title: "Uphill" },
    ] as unknown as Camera[];

    const sortedIds = Camera.sortByTerminalDisplayOrder(cameras).map(
      ({ id }) => {
        // expose sort result
        return id;
      }
    );

    expect(sortedIds).toEqual(["holding", "uphill", "dock"]);
  });
});
