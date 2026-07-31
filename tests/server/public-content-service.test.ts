import { beforeEach, describe, expect, it, vi } from "vitest";

const announcements = vi.hoisted(() => ({ findAll: vi.fn() }));
const controls = vi.hoisted(() => ({ findOrCreate: vi.fn() }));

vi.mock("~/models/Announcement", () => ({ Announcement: announcements }));
vi.mock("~/models/SiteControl", () => ({ SiteControl: controls }));

import {
  getPublicContent,
  getRobotsTxt,
  parseCrawlerPolicy,
} from "../../server/services/public/content";

describe("public content query service", () => {
  beforeEach(() => {
    announcements.findAll.mockReset();
    controls.findOrCreate.mockReset();
  });

  it("returns only published announcement fields with persisted public controls", async () => {
    controls.findOrCreate.mockResolvedValue([
      {
        crawlerPolicy: { aiCrawlers: "disallow", disallowPaths: ["/admin"] },
        leaderboardIndexingEnabled: false,
        leaderboardSharingEnabled: true,
        maintenanceEnabled: true,
        maintenanceMessage: "Brief maintenance",
      },
    ]);
    announcements.findAll.mockResolvedValue([
      { body: "Service work", id: "notice-1", title: "Notice" },
    ]);

    await expect(getPublicContent()).resolves.toEqual({
      announcements: [
        { body: "Service work", id: "notice-1", title: "Notice" },
      ],
      crawlerPolicy: { aiCrawlers: "disallow", disallowPaths: ["/admin"] },
      leaderboardIndexingEnabled: false,
      leaderboardSharingEnabled: true,
      maintenance: { enabled: true, message: "Brief maintenance" },
    });
    expect(announcements.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { published: true } })
    );
  });

  it("normalizes crawler policies and preserves the robots policy contract", () => {
    expect(
      parseCrawlerPolicy({
        aiCrawlers: "allow",
        disallowPaths: ["/admin", "/admin"],
      })
    ).toEqual({ aiCrawlers: "allow", disallowPaths: ["/admin"] });
    expect(
      parseCrawlerPolicy({ aiCrawlers: "allow", disallowPaths: ["/"] })
    ).toBeUndefined();
    expect(
      getRobotsTxt({ aiCrawlers: "disallow", disallowPaths: ["/admin"] })
    ).toContain("User-agent: GPTBot\nDisallow: /");
    const allowedAi = getRobotsTxt({
      aiCrawlers: "allow",
      disallowPaths: ["/account", "/admin"],
    });
    for (const agent of ["Googlebot", "Bingbot", "DuckDuckBot", "GPTBot"]) {
      expect(allowedAi).toContain(
        `User-agent: ${agent}\nDisallow: /account\nDisallow: /admin\nAllow: /`
      );
    }
  });
});
