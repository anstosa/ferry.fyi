// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { Level, type Bulletin } from "../../shared/contracts/bulletins";
import type { Terminal } from "../../shared/contracts/terminals";
import { getRouteBulletins, getWaitTime } from "../../client/lib/bulletins";

const getTerminal = (id: string, bulletins: Bulletin[] | undefined): Terminal =>
  ({ id, name: id, bulletins }) as Terminal;

describe("bulletin summaries", () => {
  it("formats WSF wait-time bulletin titles", () => {
    expect(getWaitTime({ title: "Seattle: 90 Minute Wait" } as Bulletin)).toBe(
      "1.5hr wait"
    );
    expect(getWaitTime({ title: "Service update" } as Bulletin)).toBeNull();
  });
});

describe("route bulletins", () => {
  // filter cached promotions from both sides while retaining service alerts
  it("excludes opinion-group alerts from the route list and count", () => {
    const promotion = {
      bodyText: "Join the Ferry Riders Opinion Group today.",
      date: 300,
      level: Level.HIGH,
      terminalId: "5",
      title: "All routes - Have your say",
    } as Bulletin;
    const legacyPromotion = {
      bodyHTML:
        "<p>Ferry Riders <strong>Opinion Group</strong> recruitment</p>",
      date: 200,
      terminalId: "14",
      title: "All routes - Join us",
    } as Bulletin;
    const serviceAlert = {
      bodyText: "Use the alternate loading area.",
      date: 100,
      level: Level.HIGH,
      terminalId: "5",
      title: "Terminal construction",
    } as Bulletin;
    const bulletins = getRouteBulletins(
      getTerminal("5", [promotion, serviceAlert]),
      getTerminal("14", [legacyPromotion])
    );

    expect(bulletins).toHaveLength(1);
    expect(bulletins[0].title).toBe("Terminal construction");
  });

  it("normalizes legacy API bulletins", () => {
    const legacyBulletin = {
      bodyHTML: "<p>Service &amp; loading update</p>",
      date: 100,
      terminalId: "5",
      title: "Clinton update",
    } as Bulletin;

    expect(getRouteBulletins(getTerminal("5", [legacyBulletin]), null)).toEqual(
      [
        {
          ...legacyBulletin,
          bodyText: "Service & loading update",
          level: Level.INFO,
          routePrefix: "All",
        },
      ]
    );
  });

  it("deduplicates legacy route bulletins", () => {
    const bulletin = {
      bodyHTML: "<p>Route update</p>",
      date: 100,
      terminalId: "5",
      title: "Service alert",
    } as Bulletin;
    const mateBulletin = { ...bulletin, terminalId: "14" };

    expect(
      getRouteBulletins(
        getTerminal("5", [bulletin]),
        getTerminal("14", [mateBulletin])
      )
    ).toHaveLength(1);
  });

  it("handles terminals without a bulletin list", () => {
    expect(getRouteBulletins(getTerminal("5", undefined), null)).toEqual([]);
  });
});
