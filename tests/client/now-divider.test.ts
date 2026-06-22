import { describe, expect, it } from "vitest";
import type { Slot } from "shared/contracts/schedules";

import { shouldRenderNowDivider } from "../../client/views/Schedule/nowDivider";

// build minimal slot
const makeSlot = (hasPassed: boolean): Slot =>
  ({ hasPassed }) as Slot;

// now divider boundary
describe("shouldRenderNowDivider", () => {
  // boundary case
  it("renders before the next sailing when a previous sailing has passed", () => {
    const previousSlot = makeSlot(true);
    const currentSlot = makeSlot(false);

    expect(
      shouldRenderNowDivider({ currentSlot, previousSlot, slot: currentSlot })
    ).toBe(true);
  });

  // past row case
  it("does not render before a previous sailing", () => {
    const previousSlot = makeSlot(true);
    const currentSlot = makeSlot(false);

    expect(
      shouldRenderNowDivider({ currentSlot, previousSlot, slot: previousSlot })
    ).toBe(false);
  });

  // first row case
  it("does not render without a passed previous sailing", () => {
    const currentSlot = makeSlot(false);

    expect(shouldRenderNowDivider({ currentSlot, slot: currentSlot })).toBe(
      false
    );
  });
});
