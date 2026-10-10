import { describe, expect, it } from "vitest";

import { formatUpdatedAt } from "../../shared/lib/freshness";

describe("formatUpdatedAt", () => {
  const now = 1_700_000_000;

  it("does not render unknown or unusable source times as fresh", () => {
    expect(formatUpdatedAt(null, now)).toBeNull();
    expect(formatUpdatedAt(undefined, now)).toBeNull();
    expect(formatUpdatedAt(Number.NaN, now)).toBeNull();
    expect(formatUpdatedAt(now + 1, now)).toBe("Updated just now");
  });

  it("formats timestamps less than one minute old as just now", () => {
    expect(formatUpdatedAt(now, now)).toBe("Updated just now");
    expect(formatUpdatedAt(now - 59, now)).toBe("Updated just now");
  });

  it("formats elapsed whole minutes with a singular and plural label", () => {
    expect(formatUpdatedAt(now - 60, now)).toBe("Updated 1 min ago");
    expect(formatUpdatedAt(now - 179, now)).toBe("Updated 2 mins ago");
  });

  // distinguish camera checks from source image changes
  it("accepts a precise prefix without changing unknown-time behavior", () => {
    expect(formatUpdatedAt(now, now, "Image checked")).toBe(
      "Image checked just now"
    );
    expect(formatUpdatedAt(now - 60, now, "Image checked")).toBe(
      "Image checked 1 min ago"
    );
    expect(formatUpdatedAt(now - 179, now, "Image checked")).toBe(
      "Image checked 2 mins ago"
    );
    expect(formatUpdatedAt(null, now, "Image checked")).toBeNull();
  });
});
