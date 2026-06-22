interface CapacityFillClassNameOptions {
  isFull: boolean;
  isDaylight: boolean;
}

// choose capacity fill
export const getCapacityFillClassName = ({
  isDaylight,
  isFull,
}: CapacityFillClassNameOptions): string => {
  // full sailings are striped
  if (isFull) {
    return isDaylight ? "bg-full-day" : "bg-full-night";
  }

  return isDaylight ? "bg-yellow-medium" : "bg-blue-medium";
};

interface CapacityOpacityClassNameOptions {
  hasPassed: boolean;
}

// choose capacity opacity
export const getCapacityOpacityClassName = ({
  hasPassed,
}: CapacityOpacityClassNameOptions): string => {
  // past sailings fade
  if (hasPassed) {
    return "opacity-50";
  }

  return "";
};
