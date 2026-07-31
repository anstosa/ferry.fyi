import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

import { clientBuildEnvDefines, clientViteAliases } from "./vite.shared";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "..");
const nodeBuiltins = [
  ...new Set([
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
  ]),
];

/**
 * This deliberately produces one deployable renderer. React and router stay
 * inside it because the runtime Docker stage installs production dependencies
 * only; Node built-ins remain native imports.
 */
export default defineConfig({
  root: configDir,
  define: clientBuildEnvDefines(),
  plugins: [
    react(),
    svgr({
      include: "**/*.svg",
      svgrOptions: {
        icon: true,
        svgProps: { fill: "currentColor", className: "inline-block" },
      },
    }),
  ],
  resolve: { alias: clientViteAliases, preserveSymlinks: true },
  css: {
    postcss: repoRoot,
  },
  build: {
    emptyOutDir: true,
    minify: true,
    outDir: path.resolve(repoRoot, "dist/ssr"),
    sourcemap: true,
    ssr: path.resolve(configDir, "entry-server.tsx"),
    target: "node24",
    rollupOptions: {
      external: nodeBuiltins,
      output: {
        entryFileNames: "entry-server.mjs",
        format: "es",
        inlineDynamicImports: true,
      },
    },
  },
  ssr: { noExternal: true },
});
