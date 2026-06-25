const colors = {
  darken: {
    low: "rgba(0, 0, 0, .30)",
  },
  green: {
    dark: "#016f52",
  },
  blue: {
    dark: "#004d61",
  },
  countdown: "#6fb8a6",
  lighten: {
    medium: "rgba(255, 255, 255, .50)",
    high: "rgba(255, 255, 255, .70)",
  },
  white: "#fff",
} as const;

const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

export { colors, isDark };
