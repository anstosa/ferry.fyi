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
    emptyOutDir: false,
    minify: true,
    outDir: path.resolve(repoRoot, "dist/server"),
    ssr: path.resolve(configDir, "server.ts"),
    target: "node24",
    rollupOptions: {
      output: {
        entryFileNames: "server.js",
        format: "cjs",
      },
    },
  },
});
