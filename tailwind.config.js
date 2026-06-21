// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const borderPlugin = ({ addUtilities }) => {
  const newUtilities = {};
  const DIRECTIONS = { top: "t", right: "r", bottom: "b", left: "l" };

  Object.keys(DIRECTIONS).forEach((direction) => {
    const abbreviation = DIRECTIONS[direction];
    ["solid", "dashed", "dotted", "none"].forEach((style) => {
      const utility = [".border", abbreviation, style].join("-");
      const key = ["border", direction, "style"].join("-");
      const value = style;
      newUtilities[utility] = { [key]: value };
    });
  });

  addUtilities(newUtilities);
};

module.exports = {
  corePlugins: {},
  important: false,
  plugins: [borderPlugin],
  prefix: "",
  content: ["./client/**/*.{ts,tsx}", "./client/**/*.html"],
  separator: ":",
  theme: {
    extend: {
      colors: {
        transparent: "transparent",

        black: "#000",
        gray: {
          lightest: "#fafafa",
          light: "#e5e5e5",
          medium: "#b5b5b5",
          dark: "#3d3d3d",
          darkest: "#1f1f1f",
        },
        white: "#fff",

        darken: {
          lowest: "rgba(0, 0, 0, .05)",
          lower: "rgba(0, 0, 0, .10)",
          low: "rgba(0, 0, 0, .30)",
          medium: "rgba(0, 0, 0, .50)",
          high: "rgba(0, 0, 0, .70)",
          highest: "rgba(0, 0, 0, .90)",
        },
        lighten: {
          lowest: "rgba(255, 255, 255, .05)",
          lower: "rgba(255, 255, 255, .10)",
          low: "rgba(255, 255, 255, .30)",
          medium: "rgba(255, 255, 255, .50)",
          high: "rgba(255, 255, 255, .70)",
          highest: "rgba(255, 255, 255, .90)",
        },

        green: {
          lightest: "#e6f4f0",
          light: "#6fb8a6",
          dark: "#016f52", // sync with client/lib/theme.ts
        },

        red: {
          light: "#fde7e7",
          dark: "#b42318",
        },

        blue: {
          lightest: "#e7f2f6",
          light: "#b8d5de",
          medium: "#3f7d8c",
          dark: "#004d61",
          darkest: "#002f3b",
        },

        yellow: {
          lightest: "#fff8db",
          medium: "#f2b705",
          dark: "#7a5400",
        },
      },
      inset: {
        "1/2": "50%",
        full: "100%",
      },
      fontSize: {
        "2xs": "0.65rem",
      },
      screen: {
        pwa: { raw: "(display-mode: standalone)" },
      },
      spacing: {
        "2px": "2px",
        "1/3": "calc(100% / 3)",
        "2/5": "40%",
        halfscreen: "50vh",
        full: "100%",
        "safe-bottom": "env(safe-area-inset-bottom)",
        "safe-left": "env(safe-area-inset-left)",
        "safe-right": "env(safe-area-inset-right)",
        "safe-top": "env(safe-area-inset-top)",
      },
      width: (theme) => ({
        ...theme("spacing"),
      }),
      zIndex: {
        bottom: "-1",
        auto: "auto",
      },
    },
  },
};
