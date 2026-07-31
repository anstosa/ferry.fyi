import { isObject } from "shared/lib/objects";

import { Announcement } from "~/models/Announcement";
import { SiteControl } from "~/models/SiteControl";

const SITE_CONTROL_KEY = "public";
const allowedCrawlerPaths = [
  "/account",
  "/admin",
  "/callback",
  "/leaderboards/settings",
] as const;
const aiCrawlerAgents = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
] as const;

export interface CrawlerPolicy {
  aiCrawlers: "allow" | "disallow";
  disallowPaths: string[];
}

export interface PublicAnnouncement {
  body: string;
  id: string;
  title: string;
}

export interface PublicContent {
  announcements: PublicAnnouncement[];
  crawlerPolicy: CrawlerPolicy;
  leaderboardIndexingEnabled: boolean;
  leaderboardSharingEnabled: boolean;
  maintenance: { enabled: boolean; message: string };
}

const defaultCrawlerPolicy = (): CrawlerPolicy => ({
  aiCrawlers: "allow",
  disallowPaths: [],
});

const isCrawlerPolicy = (value: unknown): value is CrawlerPolicy =>
  isObject(value) &&
  (value.aiCrawlers === "allow" || value.aiCrawlers === "disallow") &&
  Array.isArray(value.disallowPaths) &&
  value.disallowPaths.every(
    (path): path is string =>
      typeof path === "string" &&
      (allowedCrawlerPaths as readonly string[]).includes(path)
  );

export const parseCrawlerPolicy = (
  value: unknown
): CrawlerPolicy | undefined => {
  if (!isCrawlerPolicy(value)) {
    return undefined;
  }
  return {
    aiCrawlers: value.aiCrawlers,
    disallowPaths: [...new Set(value.disallowPaths)].sort(),
  };
};

const getSiteControl = async (): Promise<SiteControl> => {
  const [control] = await SiteControl.findOrCreate({
    defaults: {
      crawlerPolicy: defaultCrawlerPolicy(),
      key: SITE_CONTROL_KEY,
      leaderboardIndexingEnabled: true,
      leaderboardSharingEnabled: true,
      maintenanceEnabled: false,
      maintenanceMessage: "",
    },
    where: { key: SITE_CONTROL_KEY },
  });
  return control;
};

export const asCrawlerPolicy = (value: unknown): CrawlerPolicy =>
  parseCrawlerPolicy(value) ?? defaultCrawlerPolicy();

/** Public persisted notices and visibility controls, with no admin-only data. */
export const getPublicContent = async (): Promise<PublicContent> => {
  const [control, announcements] = await Promise.all([
    getSiteControl(),
    Announcement.findAll({
      attributes: ["id", "title", "body"],
      order: [
        ["updatedAt", "DESC"],
        ["id", "ASC"],
      ],
      where: { published: true },
    }),
  ]);
  return {
    announcements: announcements.map(({ body, id, title }) => ({
      body,
      id,
      title,
    })),
    crawlerPolicy: asCrawlerPolicy(control.crawlerPolicy),
    leaderboardIndexingEnabled: control.leaderboardIndexingEnabled,
    leaderboardSharingEnabled: control.leaderboardSharingEnabled,
    maintenance: {
      enabled: control.maintenanceEnabled,
      message: control.maintenanceMessage,
    },
  };
};

export const getRobotsTxt = (policy: CrawlerPolicy): string => {
  const paths = policy.disallowPaths
    .map((path) => `Disallow: ${path}`)
    .join("\n");
  const generalRules = paths ? `${paths}\nAllow: /` : "Allow: /";
  const aiRules = policy.aiCrawlers === "allow" ? generalRules : "Disallow: /";
  return [
    "# Ferry FYI crawler policy.",
    "User-agent: *",
    generalRules,
    "",
    "User-agent: Googlebot",
    generalRules,
    "",
    "User-agent: Bingbot",
    generalRules,
    "",
    "User-agent: DuckDuckBot",
    generalRules,
    "",
    ...aiCrawlerAgents.flatMap((agent) => [
      `User-agent: ${agent}`,
      aiRules,
      "",
    ]),
    "Sitemap: https://ferry.fyi/sitemap.xml",
    "",
  ].join("\n");
};
