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
  "Plan Washington State Ferries trips with route schedules, sailing times, service alerts, traffic cameras, fares, and vehicle-capacity forecasts.";
export const SEO_DEFAULT_TITLE =
  "Ferry FYI - Washington State Ferries Schedules & Tracker";
// Update when the server-rendered indexable content changes substantially.
export const SEO_CONTENT_LAST_MODIFIED = "2026-07-29";
export const SEO_DESCRIPTION_FAILURE_LENGTH = 100;
export const SEO_DESCRIPTION_TARGET_MIN_LENGTH = 120;
export const SEO_DESCRIPTION_TARGET_MAX_LENGTH = 160;
export const SEO_DESCRIPTION_EDITORIAL_REVIEW_LENGTH = 180;
/**
 * Exceptions are keyed by canonical URL path and require an editorial reason.
 * Keep these empty when every generated description is in the preferred range.
 */
export const SEO_DESCRIPTION_SHORT_RATIONALES: Readonly<
  Record<string, string>
> = {};
export const SEO_DESCRIPTION_LONG_REVIEW_NOTES: Readonly<
  Record<string, string>
> = {};
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
export const SEO_INDEXABLE_ROUTE_VIEWS = [
  "cameras",
  "map",
  "alerts",
  "subscribe",
  "fare",
] as const satisfies readonly Exclude<SeoView, "terminal">[];
export const SEO_INDEXABLE_PATHS = [
  "/",
  "/about",
  "/forecasting",
  "/data-sources",
  "/tickets",
  "/privacy",
  "/feedback",
] as const;

const fixedPages: Record<string, Pick<SeoMetadata, "title" | "description">> = {
  "/about": {
    title: "About Ferry FYI - Washington State Ferries Schedules",
    description:
      "Learn how Ferry FYI independently helps riders plan Washington State Ferries trips with schedules, service context, forecasts, and route tools.",
  },
  "/forecasting": {
    title: "Ferry Capacity, Delay, and Tide Forecasting - Ferry FYI",
    description:
      "Learn how Ferry FYI estimates Washington State Ferries vehicle capacity, schedule delays, and low-tide cancellation risk.",
  },
  "/data-sources": {
    title: "Ferry FYI Data Sources and API Guide",
    description:
      "Learn how Ferry FYI sources and timestamps Washington State Ferries schedules, vessels, forecasts, cameras, weather, tides, and public read-only APIs.",
  },
  "/tickets": {
    title: "Washington State Ferry Tickets & Barcode Scanner - Ferry FYI",
    description:
      "Use Ferry FYI to save eligible Washington State Ferry tickets, refresh ticket status, and scan supported barcodes without exposing ticket details publicly.",
  },
  "/privacy": {
    title: "Privacy Policy - Ferry FYI",
    description:
      "Read how Ferry FYI handles account, foreground location, ticket, notification, analytics, and diagnostic data across the web and mobile apps.",
  },
  "/feedback": {
    title: "Ferry FYI Support & Feedback",
    description:
      "Contact Ferry FYI support to report inaccurate ferry information, troubleshoot the app, share feedback, or request a trip-planning feature.",
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
  creator: { "@id": `${getSeoUrl(baseUrl, "/")}#organization` },
  dateModified: SEO_CONTENT_LAST_MODIFIED,
  isAccessibleForFree: true,
  measurementTechnique:
    "Ferry FYI combines source observations with documented schedule, capacity, delay, weather, and tide forecast methods; timestamps describe source freshness rather than guaranteed current conditions.",
  name: "Ferry FYI ferry planning data",
  provider: [
    { "@type": "Organization", name: "Washington State Ferries" },
    { "@type": "Organization", name: "Open-Meteo" },
    { "@type": "Organization", name: "NOAA" },
  ],
  spatialCoverage: {
    "@type": "Place",
    name: "Washington State, United States",
  },
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

/** Fixed anonymous metadata for the request-neutral public 404 document. */
export const getNotFoundSeoMetadata = (): SeoMetadata => {
  const canonicalPath = "/404";
  const title = "Page Not Found - Ferry FYI";
  const description = "The requested Ferry FYI page could not be found.";
  return {
    canonicalPath,
    description,
    robots: "noindex,follow",
    schema: getWebPageSchema(title, description, canonicalPath),
    title,
  };
};

export const getTerminalSeoMetadata = (terminal: SeoTerminal): SeoMetadata => {
  const canonicalPath = `/${terminal.slug}/terminal`;
  const title = `${terminal.name} Ferry Terminal Information - ${SEO_APP_NAME}`;
  const description = `Plan a trip through the Washington State Ferries ${terminal.name} terminal with location details, amenities, route connections, and current travel context.`;
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
    "Check whether the Clinton to Mukilteo Washington State Ferries route is operating with one boat or two today, with current sailing context.";
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
  const routeName = `${terminal.name} to ${mate.name}`;
  const routePage = getRoutePageCopy(routeName, view);
  return {
    canonicalPath,
    description: routePage.description,
    robots: isDated ? "noindex,follow" : "index,follow",
    schema: getWebPageSchema(
      routePage.title,
      routePage.description,
      canonicalPath
    ),
    title: routePage.title,
  };
};

const getRoutePageCopy = (
  routeName: string,
  view: Exclude<SeoView, "terminal">
): Pick<SeoMetadata, "title" | "description"> => {
  switch (view) {
    case "cameras":
      return {
        title: `${routeName} Ferry Cameras - ${SEO_APP_NAME}`,
        description: `View traffic camera images, source update times, and freshness details for the ${routeName} Washington State Ferries route before traveling.`,
      };
    case "map":
      return {
        title: `${routeName} Ferry Map & Vessel Locations - ${SEO_APP_NAME}`,
        description: `Explore vessel locations, terminal geography, and route context for the ${routeName} Washington State Ferries crossing before your trip.`,
      };
    case "alerts":
      return {
        title: `${routeName} Ferry Service Alerts - ${SEO_APP_NAME}`,
        description: `Review current Washington State Ferries service bulletins, reported cancellations, and rider alerts for the ${routeName} route.`,
      };
    case "subscribe":
      return {
        title: `${routeName} Ferry Alerts & Notifications - ${SEO_APP_NAME}`,
        description: `Learn about and configure Ferry FYI sailing, capacity, and service-alert notifications for the ${routeName} Washington State Ferries route.`,
      };
    case "fare":
      return {
        title: `${routeName} Ferry Fares - ${SEO_APP_NAME}`,
        description: `Browse official Washington State Ferries fare options and build a trip estimate for the ${routeName} route, travel date, and rider mix.`,
      };
    case "schedule":
      return {
        title: `${routeName} Ferry Schedule - ${SEO_APP_NAME}`,
        description: `Plan the ${routeName} direction with Washington State Ferries sailing times, schedule details, service updates, and vehicle-capacity forecasts.`,
      };
  }
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
  const description = `View public all-time, monthly, and weekly Ferry FYI rankings from eligible foreground check-ins at the ${terminal.name} Washington State Ferries terminal.`;
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
  const description = `See the public Ferry FYI information page for WSF vessel ${vessel.name}; vessel check-ins and leaderboard rankings are not currently available.`;
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
    "Browse public Ferry FYI terminal leaderboards based on eligible foreground check-ins, plus vessel pages where check-in rankings are not yet available.";
  return {
    canonicalPath,
    description,
    robots: "index,follow",
    schema: getWebPageSchema(title, description, canonicalPath),
    title,
  };
};

export interface SeoDescriptionAuditEntry {
  canonicalPath: string;
  description: string;
}

export interface SeoDescriptionAuditResult {
  reviewedLongUrls: string[];
  shortRationaleUrls: string[];
  targetUrls: string[];
}

export interface SeoDescriptionAuditReviews {
  longReviewNotes?: Readonly<Record<string, string>>;
  shortRationales?: Readonly<Record<string, string>>;
}

const normalizeSeoDescription = (description: string): string =>
  description.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

/**
 * Enforces the release-owned description policy for a complete generated URL
 * set. Callers must pass every canonical URL they intend to expose.
 */
export const auditIndexableSeoDescriptions = (
  entries: readonly SeoDescriptionAuditEntry[],
  reviews: SeoDescriptionAuditReviews = {}
): SeoDescriptionAuditResult => {
  const failures: string[] = [];
  const normalizedOwners = new Map<string, string>();
  const entryPaths = new Set(entries.map(({ canonicalPath }) => canonicalPath));
  const longReviewNotes =
    reviews.longReviewNotes ?? SEO_DESCRIPTION_LONG_REVIEW_NOTES;
  const shortRationales =
    reviews.shortRationales ?? SEO_DESCRIPTION_SHORT_RATIONALES;
  const result: SeoDescriptionAuditResult = {
    reviewedLongUrls: [],
    shortRationaleUrls: [],
    targetUrls: [],
  };
  Object.keys(shortRationales).forEach((canonicalPath) => {
    if (!entryPaths.has(canonicalPath)) {
      failures.push(`${canonicalPath}: stale short-description rationale`);
    }
  });
  Object.keys(longReviewNotes).forEach((canonicalPath) => {
    if (!entryPaths.has(canonicalPath)) {
      failures.push(`${canonicalPath}: stale long-description review`);
    }
  });

  entries.forEach(({ canonicalPath, description }) => {
    const normalized = normalizeSeoDescription(description);
    if (!normalized) {
      failures.push(`${canonicalPath}: empty description`);
      return;
    }
    const duplicateOwner = normalizedOwners.get(normalized);
    if (duplicateOwner) {
      failures.push(
        `${canonicalPath}: normalized description duplicates ${duplicateOwner}`
      );
    } else {
      normalizedOwners.set(normalized, canonicalPath);
    }

    const { length } = description.trim();
    if (length < SEO_DESCRIPTION_FAILURE_LENGTH) {
      failures.push(`${canonicalPath}: description is ${length} characters`);
    } else if (length < SEO_DESCRIPTION_TARGET_MIN_LENGTH) {
      if (shortRationales[canonicalPath]?.trim()) {
        result.shortRationaleUrls.push(canonicalPath);
      } else {
        failures.push(
          `${canonicalPath}: ${length}-character description needs a checked-in rationale`
        );
      }
    } else if (length <= SEO_DESCRIPTION_TARGET_MAX_LENGTH) {
      result.targetUrls.push(canonicalPath);
    } else if (length > SEO_DESCRIPTION_EDITORIAL_REVIEW_LENGTH) {
      if (longReviewNotes[canonicalPath]?.trim()) {
        result.reviewedLongUrls.push(canonicalPath);
      } else {
        failures.push(
          `${canonicalPath}: ${length}-character description needs editorial review`
        );
      }
    }
  });

  if (failures.length) {
    throw new Error(`SEO description audit failed:\n${failures.join("\n")}`);
  }
  return result;
};
