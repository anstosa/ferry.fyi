import { describe, expect, it } from "vitest";
import { isEqual, setNested } from "../../shared/lib/objects";

// object utilities
describe("shared object utilities", () => {
  // nested write
  it("creates nested objects while setting a value", () => {
    const target: Record<string, unknown> = {};

    setNested(target, ["route", "terminal", "id"], "sea");

    expect(target).toEqual({ route: { terminal: { id: "sea" } } });
  });

  // structural equality
  it("compares arrays and nested objects structurally", () => {
    expect(
      isEqual(
        { routes: [{ id: "sea", mates: ["bainbridge"] }] },
        { routes: [{ id: "sea", mates: ["bainbridge"] }] }
      )
    ).toBe(true);
  });

  // structural mismatch
  it("rejects nested structural mismatches", () => {
    expect(
      isEqual(
        { routes: [{ id: "sea", mates: ["bainbridge"] }] },
        { routes: [{ id: "sea", mates: ["bremerton"] }] }
      )
    ).toBe(false);
  });
});
