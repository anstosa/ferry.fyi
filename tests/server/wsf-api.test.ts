import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("heroku-logger", () => ({
  default: { error: vi.fn() },
}));

const { wsfRequest } = await import("../../server/lib/wsf/api");

describe("WSF API requests", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the fixed WSF origin and encoded path segments", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    await wsfRequest("https://www.wsdot.wa.gov/ferries/api/vessels/rest/one two");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/www\.wsdot\.wa\.gov\/ferries\/api\/vessels\/rest\/one%20two\?apiaccesscode=/
      ),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("rejects a non-WSF URL before making a request", async () => {
    await expect(wsfRequest("https://example.test/internal")).rejects.toThrow(
      "Refused invalid WSF URL"
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied query strings", async () => {
    await expect(
      wsfRequest("https://www.wsdot.wa.gov/ferries/api/vessels/rest?target=internal")
    ).rejects.toThrow("Refused invalid WSF URL");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
