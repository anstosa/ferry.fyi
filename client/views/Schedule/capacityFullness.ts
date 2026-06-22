import { isNil } from "shared/lib/identity";

export const FULL_CAPACITY_THRESHOLD = 90;

interface CapacityFullOptions {
  percentFull?: number | null;
  spacesLeft?: number | null;
}

// classify full capacity
export const isCapacityFull = ({
  percentFull,
  spacesLeft,
}: CapacityFullOptions): boolean => {
  // explicit full
  if (!isNil(spacesLeft) && spacesLeft <= 0) {
    return true;
  }

  // practical full
  if (!isNil(percentFull) && percentFull > FULL_CAPACITY_THRESHOLD) {
    return true;
  }

  return false;
};

interface CapacityDisplayPercentOptions {
  isFull: boolean;
  percentFull?: number | null;
}

// choose display percent
export const getCapacityDisplayPercent = ({
  isFull,
  percentFull,
}: CapacityDisplayPercentOptions): number => {
  // full display
  if (isFull) {
    return 100;
  }

  return percentFull ?? 0;
};
