import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import svgr from "vite-plugin-svgr";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDirectory, "../../..");
const productionCard = path.resolve(
  repoRoot,
  "client/views/Schedule/SailingRecommendationCard.tsx"
);
const productionClient = path.resolve(
  repoRoot,
  "client/lib/sailingRecommendations.ts"
);

// replace only the two side-effecting imports used by the production card
const deterministicAdapters = (): Plugin => ({
  name: "sailing-recommendation-deterministic-adapters",
  enforce: "pre",
  // bind adapters only for their exact production importers
  resolveId(source, importer) {
    const normalizedImporter = importer?.split("?")[0];
    // intercept the card's foreground location helper
    if (source === "../../lib/geo" && normalizedImporter === productionCard) {
      return path.resolve(configDirectory, "geo.ts");
    }
    // intercept the feature client's low-level transport
    if (source === "./api" && normalizedImporter === productionClient) {
      return path.resolve(configDirectory, "api.ts");
    }
    return null;
  },
});

// build an isolated browser surface around the production card and parser
export default defineConfig({
  base: "./",
  define: {
    "process.env.BASE_URL": JSON.stringify("https://ferry.fyi"),
  },
  plugins: [
    deterministicAdapters(),
    react(),
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
    emptyOutDir: true,
    minify: true,
    outDir: path.resolve(repoRoot, "dist/e2e/sailing-recommendations"),
    rollupOptions: {
      input: path.resolve(configDirectory, "index.html"),
    },
  },
});
