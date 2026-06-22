import { describe, expect, it } from "vitest";

import {
  isRemovedTerminalId,
  removedTerminalIds,
} from "../../server/lib/wsf/removedTerminals";

// retired terminal guard
describe("removedTerminals", () => {
  // sidney removal
  it("marks Sidney as removed", () => {
    expect(removedTerminalIds).toContain("19");
    expect(isRemovedTerminalId("19")).toBe(true);
    expect(isRemovedTerminalId("1")).toBe(false);
  });
});
