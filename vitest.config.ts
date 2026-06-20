import path from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // repo aliases
    alias: {
      "~": path.resolve(__dirname, "server"),
      shared: path.resolve(__dirname, "shared"),
    },
  },
  test: {
    coverage: {
      include: ["shared/lib/**/*.ts", "server/lib/api.ts"],
      provider: "v8",
      reporter: ["text", "lcov"],
    },
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
