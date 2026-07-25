export interface SeoTerminal {
  name: string;
  slug: string;
}

export interface SeoRouteTerminal extends SeoTerminal {
  mates: readonly unknown[];
}

export type SeoView =
  | "schedule"
  | "cameras"
  | "terminal"
  | "map"
  | "alerts"
  | "subscribe"
  | "fare";

export interface SeoMetadata {
  canonicalPath: string;
  description: string;
  robots: "index,follow" | "noindex,follow";
  schema: Record<string, unknown>;
  title: string;
}

export interface SeoProfile {
  baseUrl?: string;
  metadata: SeoMetadata;
}

export const SEO_APP_NAME = "Ferry FYI";
export const SEO_DEFAULT_DESCRIPTION =
  "Washington State Ferries schedules, sailing times, traffic cameras, and vehicle-capacity forecasts.";
export const SEO_DEFAULT_TITLE =
  "Ferry FYI - Washington State Ferries Schedules & Tracker";
// Update when the server-rendered indexable content changes substantially.
export const SEO_CONTENT_LAST_MODIFIED = "2026-07-22";
export const SEO_HOW_MANY_BOATS_BASE_URL = "https://howmanyboats.today";
export const SEO_HOW_MANY_BOATS_HOST = "howmanyboats.today";
export const SEO_ROUTE_VIEWS: readonly SeoView[] = [
  "cameras",
  "terminal",
  "map",
  "alerts",
  "subscribe",
  "fare",
];
export const SEO_INDEXABLE_PATHS = [
  "/",
  "/about",
  "/forecasting",
  "/data-sources",
] as const;

const fixedPages: Record<string, Pick<SeoMetadata, "title" | "description">> = {
  "/about": {
    title: "About Ferry FYI - Washington State Ferries Schedules",
    description:
      "Learn about Ferry FYI, an independent Washington State Ferries schedule and tracker covering every WSF route.",
  },
  "/forecasting": {
    title: "Ferry Capacity, Delay, and Tide Forecasting - Ferry FYI",
    description:
      "Learn how Ferry FYI estimates Washington State Ferries vehicle capacity, schedule delays, and low-tide cancellation risk.",
  },
  "/data-sources": {
    title: "Ferry FYI Data Sources and API Guide",
    description:
      "Learn how Ferry FYI sources, timestamps, and explains Washington State Ferries schedules, vessel context, forecasts, cameras, weather, tide data, and public read-only APIs.",
  },
};

const indexablePaths = new Set<string>(SEO_INDEXABLE_PATHS);

const getWebPageSchema = (
  title: string,
  description: string,
  canonicalPath: string
): Record<string, unknown> => ({
  "@type": "WebPage",
  name: title,
  description,
  url: canonicalPath,
});

const getOrganizationSchema = (baseUrl: string): Record<string, unknown> => ({
  "@id": `${getSeoUrl(baseUrl, "/")}#organization`,
  "@type": "Organization",
  description:
    "Independent web and mobile app for planning Washington State Ferries trips.",
  logo: getSeoUrl(baseUrl, "/static/images/icon-512x512.png"),
  name: SEO_APP_NAME,
  url: getSeoUrl(baseUrl, "/"),
});

const getDatasetSchema = (baseUrl: string): Record<string, unknown> => ({
  "@id": `${getSeoUrl(baseUrl, "/data-sources")}#dataset`,
  "@type": "Dataset",
  description:
    "Current and historical Washington State Ferries planning data, including schedules, terminal context, vessel data, camera metadata, capacity estimates, weather, and tides.",
  distribution: {
    "@type": "DataDownload",
    contentUrl: getSeoUrl(baseUrl, "/api/terminals"),
    encodingFormat: "application/json",
  },
  name: "Ferry FYI ferry planning data",
  url: getSeoUrl(baseUrl, "/data-sources"),
  variableMeasured: [
    "Ferry schedule",
    "Vehicle capacity estimate",
    "Vessel delay",
    "Terminal camera freshness",
    "Weather forecast",
    "Tide forecast",
  ],
});

export const getSeoSchema = (
  seo: SeoMetadata,
  baseUrl: string,
  title = seo.title
): Record<string, unknown> => {
  const websiteUrl = getSeoUrl(baseUrl, "/");
  const organization = getOrganizationSchema(baseUrl);
  const webpage = {
    ...seo.schema,
    "@id": `${getSeoUrl(baseUrl, seo.canonicalPath)}#webpage`,
    dateModified: SEO_CONTENT_LAST_MODIFIED,
    isPartOf: { "@id": `${websiteUrl}#website` },
    name: title,
    publisher: { "@id": `${websiteUrl}#organization` },
    url: getSeoUrl(baseUrl, seo.canonicalPath),
  };
  const website = {
    "@id": `${websiteUrl}#website`,
    "@type": "WebSite",
    description: SEO_DEFAULT_DESCRIPTION,
    name: SEO_APP_NAME,
    publisher: { "@id": `${websiteUrl}#organization` },
    url: websiteUrl,
  };

  return {
    "@context": "https://schema.org",
    "@graph": [
      webpage,
      website,
      organization,
      ...(seo.canonicalPath === "/data-sources"
        ? [getDatasetSchema(baseUrl)]
        : []),
    ],
  };
};

export const getSeoMetadata = (pathname: string): SeoMetadata => {
  const canonicalPath = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
  const fixedPage = fixedPages[canonicalPath];
  const title = fixedPage?.title ?? SEO_DEFAULT_TITLE;
  const description = fixedPage?.description ?? SEO_DEFAULT_DESCRIPTION;
  const robots = indexablePaths.has(canonicalPath)
    ? "index,follow"
    : "noindex,follow";
  return {
    canonicalPath,
    description,
    robots,
    schema: getWebPageSchema(title, description, canonicalPath),
    title,
  };
};

export const getTerminalSeoMetadata = (terminal: SeoTerminal): SeoMetadata => {
  const canonicalPath = `/${terminal.slug}/terminal`;
  const title = `${terminal.name} Ferry Terminal Information - ${SEO_APP_NAME}`;
  const description = `Terminal information, amenities, and travel details for the Washington State Ferries ${terminal.name} terminal.`;
  return {
    canonicalPath,
    description,
    robots: "index,follow",
    schema: getWebPageSchema(title, description, canonicalPath),
    title,
  };
};

export const getHowManyBoatsSeoMetadata = (): SeoMetadata => {
  const canonicalPath = "/";
  const title = `How Many Boats? - ${SEO_APP_NAME}`;
  const description =
    "See whether the Clinton to Mukilteo ferry route is running one boat or two boats today.";
  return {
    canonicalPath,
    description,
    robots: "index,follow",
    schema: getWebPageSchema(title, description, canonicalPath),
    title,
  };
};

export const getSeoProfile = (host: string, pathname: string): SeoProfile => {
  if (host === SEO_HOW_MANY_BOATS_HOST) {
    return {
      baseUrl: SEO_HOW_MANY_BOATS_BASE_URL,
      metadata: getHowManyBoatsSeoMetadata(),
    };
  }

  return { metadata: getSeoMetadata(pathname) };
};

export const getRouteSeoMetadata = (
  terminal: SeoRouteTerminal,
  mate: SeoTerminal,
  view: Exclude<SeoView, "terminal"> = "schedule",
  isDated = false
): SeoMetadata => {
  const matePath = terminal.mates.length === 1 ? "" : `/${mate.slug}`;
  const routePath = `/${terminal.slug}${matePath}`;
  const isSchedule = view === "schedule";
  const canonicalPath = isSchedule ? routePath : `${routePath}/${view}`;
  const title = isSchedule
    ? `${terminal.name} to ${mate.name} Ferry Schedule - ${SEO_APP_NAME}`
    : `${terminal.name} to ${mate.name} ${view} - ${SEO_APP_NAME}`;
  const description = isSchedule
    ? `Washington State Ferries schedules, sailing times, vehicle-capacity forecasts, and service information for the ${terminal.name} to ${mate.name} route.`
    : `Current Washington State Ferries ${view} for the ${terminal.name} to ${mate.name} route.`;
  return {
    canonicalPath,
    description,
    robots: isSchedule && !isDated ? "index,follow" : "noindex,follow",
    schema: getWebPageSchema(title, description, canonicalPath),
    title,
  };
};

export const getDatedSeoTitle = (
  seo: SeoMetadata,
  dateLabel?: string
): string =>
  dateLabel
    ? seo.title.replace(
        ` - ${SEO_APP_NAME}`,
        ` on ${dateLabel} - ${SEO_APP_NAME}`
      )
    : seo.title;

export const getSeoUrl = (baseUrl: string, path: string): string => {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  return path === "/" ? normalizedBaseUrl : `${normalizedBaseUrl}${path}`;
};

export const getTerminalLeaderboardSeoMetadata = (terminal: {
  id: string;
  name: string;
}): SeoMetadata => {
  const canonicalPath = `/leaderboards/terminals/${encodeURIComponent(terminal.id)}`;
  const title = `${terminal.name} Terminal Leaderboard - ${SEO_APP_NAME}`;
  const description = `All-time and period leaderboard for foreground terminal check-ins at the ${terminal.name} Washington State Ferries terminal.`;
  return {
    canonicalPath,
    description,
    robots: "index,follow",
    schema: getWebPageSchema(title, description, canonicalPath),
    title,
  };
};

export const getVesselLeaderboardSeoMetadata = (vessel: {
  id: string;
  name: string;
}): SeoMetadata => {
  const canonicalPath = `/leaderboards/vessels/${encodeURIComponent(vessel.id)}`;
  const title = `${vessel.name} Vessel Leaderboard - ${SEO_APP_NAME}`;
  const description = `Public Ferry FYI leaderboard page for the Washington State Ferries vessel ${vessel.name}. Vessel check-ins are not currently available.`;
  return {
    canonicalPath,
    description,
    robots: "index,follow",
    schema: getWebPageSchema(title, description, canonicalPath),
    title,
  };
};

export const getLeaderboardsSeoMetadata = (): SeoMetadata => {
  const canonicalPath = "/leaderboards";
  const title = `Washington State Ferries Leaderboards - ${SEO_APP_NAME}`;
  const description =
    "Public Ferry FYI terminal and vessel leaderboards based on foreground location policy checks.";
  return {
    canonicalPath,
    description,
    robots: "index,follow",
    schema: getWebPageSchema(title, description, canonicalPath),
    title,
  };
};
