import { beforeEach, describe, expect, it } from "vitest";

import {
  isRemovedTerminalId,
  purgeRemovedTerminalData,
  removedTerminalIds,
} from "../../server/lib/wsf/removedTerminals";
import { Route } from "../../server/models/Route";
import { Terminal } from "../../server/models/Terminal";

// retired terminal guard
describe("removedTerminals", () => {
  // reset model cache
  beforeEach(() => {
    Route.purge();
    Terminal.purge();
  });

  // sidney removal
  it("marks Sidney as removed", () => {
    expect(removedTerminalIds).toContain("19");
    expect(isRemovedTerminalId("19")).toBe(true);
    expect(isRemovedTerminalId("1")).toBe(false);
  });

  // stale data purge
  it("purges retired terminals and routes from the cache", () => {
    new Terminal({ id: "1", name: "Anacortes" }).save();
    new Terminal({ id: "19", name: "Sidney B.C." }).save();
    new Route({
      abbreviation: "ana-sid",
      crossingTime: 0,
      date: "2026-06-22",
      description: "Anacortes / Sidney B.C.",
      id: "retired",
      terminalIds: ["1", "19"],
    }).save();
    new Route({
      abbreviation: "ana-sj",
      crossingTime: 0,
      date: "2026-06-22",
      description: "Anacortes / San Juan Islands",
      id: "active",
      terminalIds: ["1", "5"],
    }).save();

    purgeRemovedTerminalData();

    expect(Terminal.getByIndex("19")).toBeNull();
    expect(Terminal.getByIndex("1")).not.toBeNull();
    expect(Route.getByIndex("retired")).toBeNull();
    expect(Route.getByIndex("active")).not.toBeNull();
  });
});
