import { describe, expect, it } from "vitest";
import { findWhere, keyBy, Order, sortBy, without } from "../../shared/lib/arrays";

// array utilities
describe("shared array utilities", () => {
  // positional removal
  it("removes only the first matching primitive", () => {
    expect(without(["a", "b", "a"], "a")).toEqual(["b", "a"]);
  });

  // key removal
  it("removes matching objects by key", () => {
    const input = [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ];

    expect(without(input, { id: "a", value: 9 }, "id")).toEqual([
      { id: "b", value: 2 },
    ]);
  });

  // keyed lookup
  it("indexes records by a selected key", () => {
    expect(keyBy([{ id: "a" }, { id: "b" }], "id")).toEqual({
      a: { id: "a" },
      b: { id: "b" },
    });
  });

  // descending sort
  it("sorts records by key and order", () => {
    const input = [{ value: 2 }, { value: 1 }, { value: 3 }];

    expect(sortBy(input, "value", Order.DESC)).toEqual([
      { value: 3 },
      { value: 2 },
      { value: 1 },
    ]);
  });

  // property match
  it("finds the first record matching a partial shape", () => {
    expect(
      findWhere(
        [
          { id: "a", enabled: false },
          { id: "b", enabled: true },
        ],
        { enabled: true }
      )
    ).toEqual({ id: "b", enabled: true });
  });
});
