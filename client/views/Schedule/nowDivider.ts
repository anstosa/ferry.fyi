import type { Slot } from "shared/contracts/schedules";

interface ShouldRenderNowDividerOptions {
  currentSlot?: Slot;
  previousSlot?: Slot;
  slot: Slot;
}

// identify current boundary
export const shouldRenderNowDivider = ({
  currentSlot,
  previousSlot,
  slot,
}: ShouldRenderNowDividerOptions): boolean => {
  // only next sailing
  if (slot !== currentSlot) {
    return false;
  }

  // require previous sailing
  if (!previousSlot?.hasPassed) {
    return false;
  }

  return true;
};
