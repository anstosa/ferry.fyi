// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { Level, type Bulletin } from "../../shared/contracts/bulletins";
import type { Terminal } from "../../shared/contracts/terminals";
import { getRouteBulletins } from "../../client/lib/bulletins";

const getTerminal = (
  id: string,
  bulletins: Bulletin[] | undefined
): Terminal => ({ id, name: id, bulletins } as Terminal);

describe("route bulletins", () => {
  it("normalizes legacy API bulletins", () => {
    const legacyBulletin = {
      bodyHTML: "<p>Service &amp; loading update</p>",
      date: 100,
      terminalId: "5",
      title: "Clinton update",
    } as Bulletin;

    expect(getRouteBulletins(getTerminal("5", [legacyBulletin]), null)).toEqual([
      {
        ...legacyBulletin,
        bodyText: "Service & loading update",
        level: Level.INFO,
        routePrefix: "All",
      },
    ]);
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
