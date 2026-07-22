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
  breadcrumbs: readonly SeoBreadcrumb[];
  canonicalPath: string;
  description: string;
  robots: "index,follow" | "noindex,follow";
  schema: Record<string, unknown>;
  title: string;
}

export interface SeoBreadcrumb {
  name: string;
  path?: string;
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
export const SEO_INDEXABLE_PATHS = ["/", "/about", "/forecasting"] as const;

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
};

const indexablePaths = new Set<string>(SEO_INDEXABLE_PATHS);

const getFixedPageBreadcrumb = (
  canonicalPath: string,
  title: string
): string => {
  if (canonicalPath === "/about") {
    return "About";
  }
  if (canonicalPath === "/forecasting") {
    return "Forecasting";
  }
  return title;
};

const getWebPageSchema = (
  title: string,
  description: string,
  canonicalPath: string
): Record<string, unknown> => ({
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: title,
  description,
  url: canonicalPath,
});

export const getSeoSchema = (
  seo: SeoMetadata,
  baseUrl: string,
  title = seo.title
): Record<string, unknown> => ({
  ...seo.schema,
  ...(seo.breadcrumbs.length > 1
    ? {
        breadcrumb: {
          "@type": "BreadcrumbList",
          itemListElement: seo.breadcrumbs.map(({ name, path }, index) => ({
            "@type": "ListItem",
            ...(path ? { item: getSeoUrl(baseUrl, path) } : {}),
            name,
            position: index + 1,
          })),
        },
      }
    : {}),
  ...(seo.canonicalPath === "/" || seo.canonicalPath === "/about"
    ? {
        publisher: {
          "@type": "Organization",
          logo: getSeoUrl(baseUrl, "/static/images/icon-512x512.png"),
          name: SEO_APP_NAME,
          url: getSeoUrl(baseUrl, "/"),
        },
      }
    : {}),
  name: title,
  url: getSeoUrl(baseUrl, seo.canonicalPath),
  isPartOf: {
    "@type": "WebSite",
    name: SEO_APP_NAME,
    url: getSeoUrl(baseUrl, "/"),
  },
});

export const getSeoMetadata = (pathname: string): SeoMetadata => {
  const canonicalPath = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
  const fixedPage = fixedPages[canonicalPath];
  const title = fixedPage?.title ?? SEO_DEFAULT_TITLE;
  const description = fixedPage?.description ?? SEO_DEFAULT_DESCRIPTION;
  const robots = indexablePaths.has(canonicalPath)
    ? "index,follow"
    : "noindex,follow";
  const breadcrumbs: SeoBreadcrumb[] =
    robots !== "index,follow" || canonicalPath === "/"
      ? [{ name: SEO_APP_NAME, path: "/" }]
      : [
          { name: SEO_APP_NAME, path: "/" },
          { name: getFixedPageBreadcrumb(canonicalPath, title) },
        ];

  return {
    breadcrumbs,
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
  const breadcrumbs: SeoBreadcrumb[] = [
    { name: SEO_APP_NAME, path: "/" },
    { name: `${terminal.name} terminal` },
  ];

  return {
    breadcrumbs,
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
  const breadcrumbs: SeoBreadcrumb[] = [
    { name: SEO_APP_NAME, path: "/" },
    { name: "How Many Boats?" },
  ];

  return {
    breadcrumbs,
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
  const breadcrumbs: SeoBreadcrumb[] = [
    { name: SEO_APP_NAME, path: "/" },
    { name: `${terminal.name} to ${mate.name}` },
  ];

  return {
    breadcrumbs,
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
