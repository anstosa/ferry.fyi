import { describe, expect, it } from "vitest";

import {
  getSailingTripShareUrl,
  parseSailingTrip,
  redactSailingTripTelemetry,
  stripSailingTripAddress,
  withSailingTrip,
} from "../../client/lib/sailingTrip";

describe("shareable sailing controls", () => {
  // restore valid URL controls without reading an origin from the server query
  it("round trips address punctuation in the fragment and preserves unrelated state", () => {
    const trip = {
      mode: "bicycle" as const,
      buffer: 0,
      address: "123 A&B St #4, Seattle + WA",
    };
    const url = withSailingTrip(
      "/clinton/mukilteo/navigation?date=today&foo=bar#anchor&other=one",
      trip
    );
    expect(url).toContain(
      "?date=today&foo=bar&tripMode=bicycle&tripBuffer=0#anchor&other=one&tripAddress="
    );
    const parsed = new URL(url, "https://ferry.fyi");
    expect(parsed.search).not.toContain("Seattle");
    expect(parseSailingTrip(parsed.search, parsed.hash)).toEqual(trip);
    expect(parseSailingTrip("?tripAddress=Server+Query", "").address).toBe("");
  });

  // malformed fields cannot become provider requests or invalid controls
  it("rejects invalid mode, buffer and address values", () => {
    expect(
      parseSailingTrip(
        "?tripMode=hovercraft&tripBuffer=61",
        "#tripAddress=%00bad",
        12
      )
    ).toEqual({ mode: "drive", buffer: 12, address: "" });
    expect(
      parseSailingTrip("?tripBuffer=2.5", `#tripAddress=${"a".repeat(201)}`)
    ).toEqual({ mode: "drive", buffer: 5, address: "" });
    expect(parseSailingTrip("?tripBuffer=0", "").buffer).toBe(0);
    expect(parseSailingTrip("?tripBuffer=60", "").buffer).toBe(60);
  });

  // removing an address does not corrupt bare anchors or other fragment state
  it("redacts private fragment values from every telemetry URL without mutating input", () => {
    const url =
      "https://ferry.fyi/clinton/mukilteo/navigation?tripMode=walk#anchor&tripAddress=Private+House&keep=yes";
    expect(stripSailingTripAddress(url)).toBe(
      "https://ferry.fyi/clinton/mukilteo/navigation?tripMode=walk#anchor&keep=yes"
    );
    expect(
      stripSailingTripAddress("/navigation#%74ripAddress=Private+House")
    ).toBe("/navigation");
    const event = {
      request: { url },
      breadcrumbs: [{ data: { from: url, to: url } }],
      spans: [{ data: { "url.full": url, "http.url": url } }],
    };
    expect(JSON.stringify(redactSailingTripTelemetry(event))).not.toContain(
      "Private"
    );
    expect(event.request.url).toBe(url);
    expect(
      withSailingTrip("/navigation#anchor&tripAddress=old", {
        mode: "drive",
        buffer: 5,
        address: "",
      })
    ).not.toContain("tripAddress");
  });
});

// SDK payloads can contain null-prototype dictionaries and circular extras
it("redacts null-prototype records and preserves cycles safely", () => {
  const payload = Object.create(null) as Record<string, unknown>;
  payload.url = "https://ferry.fyi/navigation#tripAddress=Private+House";
  payload.self = payload;
  const clean = redactSailingTripTelemetry(payload);
  expect(clean.url).toBe("https://ferry.fyi/navigation");
  expect(clean.self).toBe(clean);
  expect(payload.url).toContain("Private");
});

// native local origins are not valid links for a recipient's browser
it("shares native trip controls on the configured public origin", () => {
  const path =
    "/clinton/mukilteo/navigation?tripMode=walk&tripBuffer=7#tripAddress=Shared+Origin";
  expect(getSailingTripShareUrl(`capacitor://localhost${path}`, true)).toBe(
    `https://ferry.fyi${path}`
  );
  expect(
    getSailingTripShareUrl(
      `https://localhost${path}`,
      true,
      "https://dev.ferry.fyi"
    )
  ).toBe(`https://dev.ferry.fyi${path}`);
  expect(getSailingTripShareUrl(`https://dev.ferry.fyi${path}`, false)).toBe(
    `https://dev.ferry.fyi${path}`
  );
});
