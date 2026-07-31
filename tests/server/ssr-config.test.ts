import { describe, expect, it } from "vitest";

import { createSsrConfig } from "../../server/ssr/config";

describe("SSR startup config", () => {
  it("defaults both switches to enabled and freezes the captured values", () => {
    const config = createSsrConfig({});
    expect(config).toEqual({ cacheEnabled: true, enabled: true });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("accepts exact lowercase boolean switches only", () => {
    expect(
      createSsrConfig({
        SSR_DOCUMENT_CACHE_ENABLED: "false",
        SSR_DOCUMENTS_ENABLED: "true",
      })
    ).toEqual({ cacheEnabled: false, enabled: true });
  });

  it("rejects invalid values without echoing their content", () => {
    expect(() =>
      createSsrConfig({ SSR_DOCUMENTS_ENABLED: "secret-invalid-value" })
    ).toThrow("SSR_DOCUMENTS_ENABLED must be exactly true or false");
    expect(() =>
      createSsrConfig({ SSR_DOCUMENT_CACHE_ENABLED: "TRUE" })
    ).toThrow("SSR_DOCUMENT_CACHE_ENABLED must be exactly true or false");
  });
});
