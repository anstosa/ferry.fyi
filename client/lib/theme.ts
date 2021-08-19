import { TailwindConfig } from "tailwindcss/tailwind-config";
import resolveConfig from "tailwindcss/resolveConfig";
import tailwindConfig from "~/../tailwind.config.js";

const { theme } = resolveConfig(tailwindConfig as unknown as TailwindConfig);

const colors = theme.colors as any;

export { colors };
