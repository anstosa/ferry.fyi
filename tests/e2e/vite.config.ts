import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDirectory, "../..");

export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: {
      "~": path.resolve(repoRoot, "server"),
      shared: path.resolve(repoRoot, "shared"),
    },
    preserveSymlinks: true,
  },
  build: {
    emptyOutDir: true,
    minify: true,
    outDir: path.resolve(repoRoot, "dist/e2e"),
    sourcemap: true,
    ssr: true,
    target: "node24",
    rollupOptions: {
      input: path.resolve(configDirectory, "ssr-fixture-server.ts"),
      output: {
        entryFileNames: "ssr-fixture-server.cjs",
        format: "cjs",
      },
    },
  },
});
