import { randomUUID } from "crypto";
import { isObject } from "shared/lib/objects";

import { Announcement } from "~/models/Announcement";
import { SiteControl } from "~/models/SiteControl";

const SITE_CONTROL_KEY = "public";
const MAX_ANNOUNCEMENT_BODY_LENGTH = 4_000;
const MAX_ANNOUNCEMENT_TITLE_LENGTH = 180;
const MAX_MAINTENANCE_MESSAGE_LENGTH = 500;
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

const normalizeText = (value: string): string => value.trim();

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

const asCrawlerPolicy = (value: unknown): CrawlerPolicy =>
  parseCrawlerPolicy(value) ?? defaultCrawlerPolicy();

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

export const getAdminContent = async () => {
  const [content, announcements] = await Promise.all([
    getPublicContent(),
    Announcement.findAll({
      order: [
        ["updatedAt", "DESC"],
        ["id", "ASC"],
      ],
    }),
  ]);
  return {
    ...content,
    announcements: announcements.map(({ body, id, published, title }) => ({
      body,
      id,
      published,
      title,
    })),
  };
};

export const saveAnnouncement = async (
  id: string,
  value: unknown
): Promise<PublicAnnouncement & { published: boolean }> => {
  if (
    !isObject(value) ||
    typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    typeof value.published !== "boolean"
  ) {
    throw new Error("Invalid announcement");
  }
  const title = normalizeText(value.title);
  const body = normalizeText(value.body);
  if (
    !title ||
    title.length > MAX_ANNOUNCEMENT_TITLE_LENGTH ||
    body.length > MAX_ANNOUNCEMENT_BODY_LENGTH
  ) {
    throw new Error("Invalid announcement");
  }
  const [announcement] = await Announcement.findOrCreate({
    defaults: { body, id, published: value.published, title },
    where: { id },
  });
  await announcement.update({ body, published: value.published, title });
  return {
    body: announcement.body,
    id: announcement.id,
    published: announcement.published,
    title: announcement.title,
  };
};

export const setMaintenance = async (
  value: unknown
): Promise<PublicContent["maintenance"]> => {
  if (
    !isObject(value) ||
    typeof value.enabled !== "boolean" ||
    typeof value.message !== "string" ||
    value.message.length > MAX_MAINTENANCE_MESSAGE_LENGTH
  ) {
    throw new Error("Invalid maintenance banner");
  }
  const control = await getSiteControl();
  await control.update({
    maintenanceEnabled: value.enabled,
    maintenanceMessage: normalizeText(value.message),
  });
  return {
    enabled: control.maintenanceEnabled,
    message: control.maintenanceMessage,
  };
};

export const setCrawlerPolicy = async (
  value: unknown
): Promise<CrawlerPolicy> => {
  const crawlerPolicy = parseCrawlerPolicy(value);
  if (!crawlerPolicy) {
    throw new Error("Invalid crawler policy");
  }
  const control = await getSiteControl();
  await control.update({ crawlerPolicy });
  return crawlerPolicy;
};

export const setLeaderboardDiscovery = async (value: unknown) => {
  if (
    !isObject(value) ||
    typeof value.indexingEnabled !== "boolean" ||
    typeof value.sharingEnabled !== "boolean"
  ) {
    throw new Error("Invalid leaderboard discovery policy");
  }
  const control = await getSiteControl();
  await control.update({
    leaderboardIndexingEnabled: value.indexingEnabled,
    leaderboardSharingEnabled: value.sharingEnabled,
  });
  return {
    indexingEnabled: control.leaderboardIndexingEnabled,
    sharingEnabled: control.leaderboardSharingEnabled,
  };
};

export const saveSiteSettings = async (
  value: unknown
): Promise<
  Pick<
    PublicContent,
    | "crawlerPolicy"
    | "leaderboardIndexingEnabled"
    | "leaderboardSharingEnabled"
    | "maintenance"
  >
> => {
  if (
    !isObject(value) ||
    typeof value.leaderboardIndexingEnabled !== "boolean" ||
    typeof value.leaderboardSharingEnabled !== "boolean" ||
    !isObject(value.maintenance) ||
    typeof value.maintenance.enabled !== "boolean" ||
    typeof value.maintenance.message !== "string" ||
    value.maintenance.message.length > MAX_MAINTENANCE_MESSAGE_LENGTH
  ) {
    throw new Error("Invalid site settings");
  }
  const crawlerPolicy = parseCrawlerPolicy(value.crawlerPolicy);
  if (!crawlerPolicy) {
    throw new Error("Invalid site settings");
  }

  const control = await getSiteControl();
  await control.update({
    crawlerPolicy,
    leaderboardIndexingEnabled: value.leaderboardIndexingEnabled,
    leaderboardSharingEnabled: value.leaderboardSharingEnabled,
    maintenanceEnabled: value.maintenance.enabled,
    maintenanceMessage: normalizeText(value.maintenance.message),
  });
  return {
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
  const aiRules = policy.aiCrawlers === "allow" ? "Allow: /" : "Disallow: /";
  return [
    "# Ferry FYI crawler policy.",
    "User-agent: *",
    generalRules,
    "",
    "User-agent: Googlebot",
    "Allow: /",
    "",
    "User-agent: Bingbot",
    "Allow: /",
    "",
    "User-agent: DuckDuckBot",
    "Allow: /",
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

/** Creates an unpublished announcement unless the caller explicitly publishes it. */
export const createAnnouncement = async (
  value: unknown
): Promise<PublicAnnouncement & { published: boolean }> =>
  saveAnnouncement(randomUUID(), value);
