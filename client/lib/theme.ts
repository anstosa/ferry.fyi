import resolveConfig from "tailwindcss/resolveConfig";

import tailwindConfig from "~/../tailwind.config.js";

const { theme } = resolveConfig(tailwindConfig as any);

const colors = theme.colors as any;
const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

export { colors, isDark };
