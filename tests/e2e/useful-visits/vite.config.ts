import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
// isolate production analytics without importing the application or its providers
export default defineConfig({
  root: directory,
  base: "./",
  plugins: [react()],
  define: {
    "process.env.GOOGLE_ANALYTICS": JSON.stringify("G-USEFUL-FIXTURE"),
    "process.env.GTM_CONTAINER_ID": JSON.stringify("GTM-USEFUL-FIXTURE"),
  },
  resolve: { alias: { "~": path.resolve(root, "client") } },
  build: {
    outDir: path.resolve(root, "dist/e2e/useful-visits"),
    emptyOutDir: true,
    manifest: true,
  },
});
