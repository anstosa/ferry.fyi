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

  return isDaylight
    ? "bg-day-confirmed-light dark:bg-day-confirmed-dark"
    : "bg-night-confirmed-light dark:bg-night-confirmed-dark";
};

interface ForecastCapacityFillClassNameOptions {
  isFull: boolean;
}

// choose forecast fill
export const getForecastCapacityFillClassName = ({
  isFull,
}: ForecastCapacityFillClassNameOptions): string | string[] => {
  // full forecasts use neutral stripes
  if (isFull) {
    return ["bg-full", "dark:bg-full--dark"];
  }

  return ["bg-prediction-gradient", "dark:bg-prediction-gradient--dark"];
};

interface CapacityOpacityClassNameOptions {
  hasDeparted: boolean;
}

// choose capacity opacity
export const getCapacityOpacityClassName = ({
  hasDeparted,
}: CapacityOpacityClassNameOptions): string => {
  // past sailings fade
  if (hasDeparted) {
    return "opacity-50";
  }

  return "";
};
