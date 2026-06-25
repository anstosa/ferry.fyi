export type CapacityStatusSide = "left" | "right";

interface CapacityStatusSideOptions {
  leftReservedWidth?: number;
  linePercent: number;
  margin: number;
  rowPadding: number;
  rowWidth: number;
  statusWidth: number;
  timeWidth: number;
}

// choose status side
export const getCapacityStatusSide = ({
  leftReservedWidth = 0,
  linePercent,
  margin,
  rowPadding,
  rowWidth,
  statusWidth,
  timeWidth,
}: CapacityStatusSideOptions): CapacityStatusSide => {
  // unmeasured rows default right
  if (rowWidth <= 0) {
    return "right";
  }
  const lineX = (linePercent / 100) * rowWidth;
  const statusLeft = Math.max(lineX, leftReservedWidth);
  const timeLeft = rowWidth - rowPadding - timeWidth;
  const statusRight = statusLeft + margin + statusWidth;
  // line collision guard
  if (lineX >= timeLeft) {
    return "left";
  }
  // label collision guard
  if (statusRight > timeLeft) {
    return "left";
  }
  return "right";
};
