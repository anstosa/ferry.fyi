import { defineConfig, devices } from "@playwright/test";

const port = 4040;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
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
  // Start just the Vite client so browser tests do not wait for server jobs.
  webServer: {
    command: "yarn start:client",
    env: {
      BASE_URL: baseURL,
    },
    url: baseURL,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
});
