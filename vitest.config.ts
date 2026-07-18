import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // repo aliases
    // Most `~` imports in this mixed client/server test suite point at server.
    // Keep that default, but resolve the client-only dependencies used by the
    // Fare view before applying it so the component can be imported in jsdom.
    alias: [
      {
        find: /^~\/components\/DateButton$/,
        replacement: path.resolve(__dirname, "client/components/DateButton"),
      },
      {
        find: /^~\/components\/InlineLoader$/,
        replacement: path.resolve(__dirname, "client/components/InlineLoader"),
      },
      {
        find: /^~\/lib\/fares$/,
        replacement: path.resolve(__dirname, "client/lib/fares"),
      },
      {
        find: /^~\/static\/images\/icons\/wsdot\.svg$/,
        replacement: path.resolve(
          __dirname,
          "client/static/images/icons/wsdot.svg"
        ),
      },
      {
        find: /^~\/views\/Header$/,
        replacement: path.resolve(__dirname, "client/views/Header"),
      },
      { find: "~", replacement: path.resolve(__dirname, "server") },
      { find: "shared", replacement: path.resolve(__dirname, "shared") },
    ],
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
