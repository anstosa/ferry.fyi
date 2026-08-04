import { defineConfig, devices } from "@playwright/test";

const port = 4177;
const baseURL = `https://ferry.fyi:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["ssr.spec.ts", "ssr-accessibility.spec.ts"],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    serviceWorkers: "allow",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium-ssr-artifacts",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--host-resolver-rules=MAP ferry.fyi 127.0.0.1, MAP howmanyboats.today 127.0.0.1",
            "--ignore-certificate-errors",
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: "node dist/e2e/ssr-fixture-server.cjs",
      env: {
        BASE_URL: baseURL,
        NODE_ENV: "test",
        PORT: String(port),
      },
      url: `https://127.0.0.1:${port}/__fixture__/health`,
      ignoreHTTPSErrors: true,
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: "node dist/e2e/ssr-fixture-server.cjs",
      env: {
        BASE_URL: "https://ferry.fyi:4178",
        NODE_ENV: "test",
        PORT: "4178",
        SSR_DOCUMENTS_ENABLED: "false",
      },
      url: "https://127.0.0.1:4178/__fixture__/health",
      ignoreHTTPSErrors: true,
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: "node dist/e2e/ssr-fixture-server.cjs",
      env: {
        BASE_URL: "https://ferry.fyi:4179",
        NODE_ENV: "test",
        PORT: "4179",
        SSR_DOCUMENT_CACHE_ENABLED: "false",
      },
      url: "https://127.0.0.1:4179/__fixture__/health",
      ignoreHTTPSErrors: true,
      timeout: 30_000,
      reuseExistingServer: false,
    },
  ],
});
