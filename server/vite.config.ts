import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "..");

export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: {
      "~": configDir,
      shared: path.resolve(repoRoot, "shared"),
    },
    preserveSymlinks: true,
  },
  build: {
    emptyOutDir: true,
    minify: true,
    outDir: path.resolve(repoRoot, "dist/server"),
    sourcemap: true,
    ssr: true,
    target: "node24",
    rollupOptions: {
      input: {
        "artifact-smoke": path.resolve(configDir, "ssr/artifactSmokeEntry.ts"),
        "forecast-worker": path.resolve(configDir, "forecastWorkerEntry.ts"),
        server: path.resolve(configDir, "main.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        format: "cjs",
      },
    },
  },
});
