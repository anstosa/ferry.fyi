import logger from "~/lib/logger";
import { describe, expect, it, vi } from "vitest";

import { createSsrRuntime } from "../../server/ssr/composition";

describe("SSR runtime composition telemetry", () => {
  it("uses the structured production logging sink by default", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    await createSsrRuntime({
      artifacts: {
        getRenderer: () =>
          Promise.resolve({
            artifactVersion: 1,
            renderPublicSsrDocument: vi.fn(),
          }),
        getTemplate: () =>
          Promise.resolve(
            '<html><head></head><body><div id="root"></div></body></html>'
          ),
      },
      config: { cacheEnabled: true, enabled: true },
    });

    expect(info).toHaveBeenCalledWith("Public SSR telemetry", {
      cacheEnabled: true,
      documentsEnabled: true,
      event: "ssr_startup",
    });
    info.mockRestore();
  });

  it("wires an injected production-compatible sink into runtime startup", async () => {
    const telemetry = vi.fn();
    await createSsrRuntime({
      artifacts: {
        getRenderer: () =>
          Promise.resolve({
            artifactVersion: 1,
            renderPublicSsrDocument: vi.fn(),
          }),
        getTemplate: () =>
          Promise.resolve(
            '<html><head></head><body><div id="root"></div></body></html>'
          ),
      },
      config: { cacheEnabled: false, enabled: true },
      telemetry,
    });

    expect(telemetry).toHaveBeenCalledWith({
      cacheEnabled: false,
      documentsEnabled: true,
      event: "ssr_startup",
    });
  });
});
