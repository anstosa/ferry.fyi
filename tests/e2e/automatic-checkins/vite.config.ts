import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

// resolve one deterministic fixture root
const configDirectory = path.dirname(fileURLToPath(import.meta.url));
// bind production source aliases from the repository root
const repoRoot = path.resolve(configDirectory, "../../..");

// build one deterministic production-component fixture
export default defineConfig({
  base: "/__automatic__/",
  define: {
    "process.env.BASE_URL": JSON.stringify("https://ferry.fyi"),
  },
  plugins: [
    // match production svg components
    svgr({
      include: "**/*.svg",
      svgrOptions: {
        icon: true,
        svgProps: { fill: "currentColor", className: "inline-block" },
      },
    }),
  ],
  root: configDirectory,
  resolve: {
    alias: [
      // bind deterministic browser adapters before broad aliases
      {
        find: "@auth0/auth0-react",
        replacement: path.join(configDirectory, "auth0.ts"),
      },
      {
        find: "@capacitor/core",
        replacement: path.join(configDirectory, "capacitor.ts"),
      },
      {
        find: "~/lib/device",
        replacement: path.join(configDirectory, "device.ts"),
      },
      {
        find: "~/lib/featureFlags",
        replacement: path.join(configDirectory, "featureFlags.ts"),
      },
      {
        find: /^~\/(.*)$/u,
        replacement: `${path.resolve(repoRoot, "client")}/$1`,
      },
      {
        find: /^shared\/(.*)$/u,
        replacement: `${path.resolve(repoRoot, "shared")}/$1`,
      },
    ],
    preserveSymlinks: true,
  },
  build: {
    emptyOutDir: false,
    minify: true,
    outDir: path.resolve(repoRoot, "dist/e2e/automatic-checkins"),
    rollupOptions: {
      input: path.resolve(configDirectory, "index.html"),
    },
  },
});
