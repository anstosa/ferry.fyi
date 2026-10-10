import { describe, expect, it } from "vitest";

import { getRouteLoadingContext } from "../../client/lib/routeLoadingContext";

// stable loading identities follow the same topology and service clock as live routes
describe("route loading context", () => {
  // aliases and explicit dates must survive the unresolved API boundary
  it("resolves aliases and requested service dates", () => {
    const context = getRouteLoadingContext("/sea/bbi/fare", "?date=2026-10-05");
    expect(context).toMatchObject({
      mate: { id: "3", name: "Bainbridge", abbreviation: "BBG" },
      selectedDate: "2026-10-05",
      terminal: { id: "7", name: "Seattle", abbreviation: "SEA" },
      view: "fare",
    });
  });

  // existing numeric links and alphabetical defaults remain consistent
  it("keeps numeric destinations distinct from the default mate", () => {
    expect(getRouteLoadingContext("/7/4/cameras")).toMatchObject({
      terminal: { name: "Seattle" },
      mate: { name: "Bremerton" },
      view: "cameras",
    });
    expect(getRouteLoadingContext("/seattle")?.mate?.name).toBe("Bainbridge");
    expect(getRouteLoadingContext("/seattle/bremerton")?.mate?.name).toBe(
      "Bremerton"
    );
  });

  // never replace full terminal names with title-cased slugs
  it("uses full terminal names", () => {
    expect(getRouteLoadingContext("/def/tlq")).toMatchObject({
      terminal: { name: "Point Defiance" },
      mate: { name: "Tahlequah" },
    });
    expect(getRouteLoadingContext("/townsend/coupeville")).toMatchObject({
      terminal: { name: "Port Townsend" },
      mate: { name: "Coupeville" },
    });
  });

  // invalid routes must not acquire fabricated page content
  it.each(["/unknown/mukilteo", "/seattle/mukilteo", "/account", "/admin"])(
    "rejects %s",
    (path) => {
      expect(getRouteLoadingContext(path)).toBeNull();
    }
  );

  // client-only navigation still has safe public labels, never an inferred origin
  it("supports static navigation content", () => {
    expect(getRouteLoadingContext("/seattle/bainbridge/navigation")?.view).toBe(
      "navigation"
    );
  });

  // bundled identity is not evidence of current facts, reports or image inventory
  it("includes only stable terminal identity", () => {
    const context = getRouteLoadingContext("/seattle/bainbridge")!;
    [context.terminal, context.mate!].forEach((terminal) => {
      expect(Object.keys(terminal).sort()).toEqual([
        "abbreviation",
        "id",
        "mates",
        "name",
      ]);
      terminal.mates?.forEach((mate) => {
        expect(Object.keys(mate).sort()).toEqual([
          "abbreviation",
          "id",
          "name",
        ]);
      });
    });
  });

  // invalid date queries follow the Pacific 03:00 service-day boundary
  it.each([
    ["2026-10-07T09:59:59Z", "2026-10-06"],
    ["2026-10-07T10:00:00Z", "2026-10-07"],
  ])("uses the correct service day at %s", (instant, expected) => {
    expect(
      getRouteLoadingContext("/seattle", "?date=invalid", Date.parse(instant))
        ?.selectedDate
    ).toBe(expected);
  });
});
