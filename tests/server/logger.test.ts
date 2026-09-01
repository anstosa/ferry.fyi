import { afterEach, describe, expect, it, vi } from "vitest";

import logger from "../../server/lib/logger";

// restore test state
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("server logger", () => {
  // structured cloud log
  it("writes one JSON record with errors and metadata", () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logger.error("Update failed", {
      error: new Error("network unavailable"),
      operation: "forecast-refresh",
    });

    expect(output).toHaveBeenCalledOnce();
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
      error: {
        message: "network unavailable",
        name: "Error",
      },
      level: "error",
      message: "Update failed",
      operation: "forecast-refresh",
    });
  });

  // configured threshold
  it("suppresses records below the configured level", () => {
    vi.stubEnv("LOG_LEVEL", "warn");
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logger.info("Hidden");
    logger.warn("Visible");

    expect(output).toHaveBeenCalledOnce();
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
      level: "warn",
      message: "Visible",
    });
  });

  // invalid threshold fallback
  it("falls back to info and warns once for each invalid value", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.stubEnv("LOG_LEVEL", "invalid-primary-test-level");
    logger.debug("Hidden debug");
    logger.info("Visible info");
    logger.warn("Visible warning");

    vi.stubEnv("LOG_LEVEL", "invalid-secondary-test-level");
    logger.error("Visible error");

    vi.stubEnv("LOG_LEVEL", "invalid-primary-test-level");
    logger.error("Still visible");

    // parse emitted records
    const records = output.mock.calls.map(([record]) =>
      JSON.parse(String(record))
    );
    expect(records).toEqual([
      {
        configuredLogLevel: "invalid-primary-test-level",
        level: "warn",
        message: "Invalid LOG_LEVEL; falling back to info",
      },
      { level: "info", message: "Visible info" },
      { level: "warn", message: "Visible warning" },
      {
        configuredLogLevel: "invalid-secondary-test-level",
        level: "warn",
        message: "Invalid LOG_LEVEL; falling back to info",
      },
      { level: "error", message: "Visible error" },
      { level: "error", message: "Still visible" },
    ]);
  });

  // circular metadata
  it("preserves logging when metadata contains a cycle", () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const metadata: Record<string, unknown> = {};
    metadata.self = metadata;

    expect(() => logger.info("Cyclic", metadata)).not.toThrow();
    expect(String(output.mock.calls[0]?.[0])).toContain("[Circular]");
  });
});
