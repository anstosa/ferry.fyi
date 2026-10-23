import { defineConfig, devices } from "@playwright/test";

// select a collision-free local browser port
const port = Number(process.env.PLAYWRIGHT_PORT ?? "4040");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // isolate dev-browser coverage from built SSR fixtures
  testMatch: ["app.spec.ts", "camera-detection-debugger.spec.ts"],
  timeout: 30_000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: devices["Desktop Chrome"],
    },
  ],
  // start only Vite so browser tests skip server jobs
  webServer: {
    command: `bash -lc 'set -a; [ ! -f .envrc ] || . ./.envrc; export BASE_URL="${baseURL}"; exec yarn start:client --host 127.0.0.1 --port ${port} --strictPort'`,
    env: {
      BASE_URL: baseURL,
    },
    url: baseURL,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
});
