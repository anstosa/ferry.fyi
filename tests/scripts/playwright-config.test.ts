import process from "node:process";

import { afterEach, describe, expect, it, vi } from "vitest";

const originalPort = process.env.PLAYWRIGHT_PORT;

// reload config after applying one isolated port override
const loadConfig = async (port?: string) => {
  vi.resetModules();

  // select the requested override or the documented default
  if (port === undefined) {
    delete process.env.PLAYWRIGHT_PORT;
  } else {
    process.env.PLAYWRIGHT_PORT = port;
  }

  return (await import("../../playwright.config")).default;
};

// restore the caller environment between config probes
afterEach(() => {
  vi.resetModules();

  // preserve an existing runner-level override
  if (originalPort === undefined) {
    delete process.env.PLAYWRIGHT_PORT;
  } else {
    process.env.PLAYWRIGHT_PORT = originalPort;
  }
});

describe("Playwright development config", () => {
  // keep development coverage separate from artifact-backed SSR tests
  it("selects only the Vite-backed browser specs", async () => {
    const config = await loadConfig();

    expect(config.testMatch).toEqual([
      "app.spec.ts",
      "camera-detection-debugger.spec.ts",
    ]);
    expect(config.use).toMatchObject({
      baseURL: "http://127.0.0.1:4040",
    });
  });

  // prove parallel maintenance runs can select a collision-free port
  it("applies PLAYWRIGHT_PORT to the server command and browser URL", async () => {
    const config = await loadConfig("4180");

    expect(config.use).toMatchObject({
      baseURL: "http://127.0.0.1:4180",
    });
    expect(config.webServer).toMatchObject({
      command:
        "bash -lc 'set -a; [ ! -f .envrc ] || . ./.envrc; export BASE_URL=\"http://127.0.0.1:4180\"; exec yarn start:client --host 127.0.0.1 --port 4180 --strictPort'",
      env: {
        BASE_URL: "http://127.0.0.1:4180",
      },
      url: "http://127.0.0.1:4180",
    });
  });
});
