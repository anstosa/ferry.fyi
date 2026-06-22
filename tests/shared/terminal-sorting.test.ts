import { describe, expect, it } from "vitest";

import { getTerminalSorter } from "../../shared/lib/terminalSorting";

// terminal sorting
describe("getTerminalSorter", () => {
  // alphabetical fallback
  it("sorts terminal lists alphabetically by name", () => {
    const terminals = [
      { id: "22", name: "Vashon" },
      { id: "1", name: "Anacortes" },
      { id: "14", name: "Mukilteo" },
    ];

    const sortedNames = terminals.sort(getTerminalSorter()).map(({ name }) => {
      // expose names
      return name;
    });

    expect(sortedNames).toEqual(["Anacortes", "Mukilteo", "Vashon"]);
  });

  // closest priority
  it("keeps the closest terminal first before alphabetical order", () => {
    const terminals = [
      { id: "22", name: "Vashon" },
      { id: "1", name: "Anacortes" },
      { id: "14", name: "Mukilteo" },
    ];

    const sortedNames = terminals
      .sort(getTerminalSorter({ id: "14" }))
      .map(({ name }) => {
        // expose names
        return name;
      });

    expect(sortedNames).toEqual(["Mukilteo", "Anacortes", "Vashon"]);
  });
});
