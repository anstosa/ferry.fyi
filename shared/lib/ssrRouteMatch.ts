import type {
  PublicSsrRouteDefinition,
  PublicSsrRouteId,
  PublicSsrRouteParams,
} from "../contracts/ssrRouting";
import ROUTE_TERMINAL_IDS from "../data/route-terminal-ids.json";
import TERMINAL_CATALOG from "../data/terminals.json";
import {
  type NormalizedPublicQuery,
  normalizePublicQuery,
} from "./ssrQueryPolicy";
import { PUBLIC_SSR_ROUTE_MANIFEST } from "./ssrRoutes";

export type PublicSsrHostProfile = "ferry.fyi" | "howmanyboats.today";

export const getPublicSsrHostProfile = (
  hostname?: string | null
): PublicSsrHostProfile | undefined => {
  const normalized = hostname
    ?.trim()
    .toLowerCase()
    .split(":")[0]
    .replace(/\.$/, "");
  if (normalized === "localhost" || normalized === "dev.ferry.fyi") {
    return "ferry.fyi";
  }
  return normalized === "ferry.fyi" || normalized === "howmanyboats.today"
    ? normalized
    : undefined;
};

export interface PublicSsrTerminalResolver {
  resolveSlug(
    slug: string
  ): { slug: string; mateSlugs?: readonly string[] } | undefined;
}

/** Browser-neutral canonical slug lookup for validated public terminal DTOs. */
export const getStaticPublicSsrTerminalSlug = (
  terminalId: string,
  catalog = TERMINAL_CATALOG as Record<string, { slug: string }>
): string | undefined => catalog[terminalId]?.slug;

export const createStaticPublicSsrTerminalResolver = (
  catalog = TERMINAL_CATALOG as Record<
    string,
    { aliases: string[]; slug: string }
  >
): PublicSsrTerminalResolver => {
  const bySlug = new Map<string, { id: string; slug: string }>();
  Object.entries(catalog).forEach(([id, entry]) => {
    bySlug.set(entry.slug, { id, slug: entry.slug });
    entry.aliases.forEach((alias) =>
      bySlug.set(alias, { id, slug: entry.slug })
    );
  });
  const mates = new Map<string, string[]>();
  Object.values(ROUTE_TERMINAL_IDS).forEach(({ terminalIds }) => {
    terminalIds.forEach((id) => {
      const list = mates.get(id) ?? [];
      terminalIds.forEach((mateId) => {
        const mate = catalog[mateId];
        if (mateId !== id && mate && !list.includes(mate.slug)) {
          list.push(mate.slug);
        }
      });
      mates.set(id, list);
    });
  });
  return {
    resolveSlug: (slug) => {
      const terminal = bySlug.get(slug);
      return terminal
        ? { mateSlugs: mates.get(terminal.id) ?? [], slug: terminal.slug }
        : undefined;
    },
  };
};
export interface PublicSsrRouteMatch {
  /** Public URL path after alias normalization; this is the SEO/snapshot path. */
  canonicalPath: string;
  /** Manifest path after resolving aliases; loaders use this internal route path. */
  routePath: string;
  params: PublicSsrRouteParams;
  query: NormalizedPublicQuery;
  route: PublicSsrRouteDefinition;
}
const decodeSegment = (value: string) => {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded !== value ||
      !/^[a-z0-9-]+$/i.test(decoded)
      ? undefined
      : decoded.toLowerCase();
  } catch {
    return undefined;
  }
};
const staticWeight = (path: string) =>
  path
    .split("/")
    .filter(Boolean)
    .filter((part) => !part.startsWith(":") && part !== "*").length;
const matchPattern = (
  route: PublicSsrRouteDefinition,
  pathname: string
): PublicSsrRouteParams | undefined => {
  if (route.path !== "*" && pathname !== "/" && pathname.endsWith("/")) {
    return undefined;
  }
  const wanted = route.path.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  if (route.path === "/") {
    return actual.length === 0 ? {} : undefined;
  }
  if (wanted[wanted.length - 1] === "*") {
    if (actual.length < wanted.length - 1) {
      return undefined;
    }
    return wanted.slice(0, -1).every((part, index) => part === actual[index])
      ? {}
      : undefined;
  }
  if (wanted.length !== actual.length) {
    return undefined;
  }
  const params: PublicSsrRouteParams = {};
  for (let index = 0; index < wanted.length; index++) {
    const pattern = wanted[index];
    const value = actual[index];
    if (pattern.startsWith(":")) {
      const decoded = decodeSegment(value);
      if (!decoded) {
        return undefined;
      }
      params[pattern.slice(1) as keyof PublicSsrRouteParams] = decoded;
    } else if (pattern !== value) {
      return undefined;
    }
  }
  return params;
};
export const matchPublicSsrRoute = (
  url: URL,
  resolver?: PublicSsrTerminalResolver
): PublicSsrRouteMatch | undefined => {
  // howmanyboats.today's public root is the Today route. Keep its external
  // canonical URL as `/`; only the loader-facing manifest path is `/today`.
  const isHowManyBoatsRoot =
    getPublicSsrHostProfile(url.hostname) === "howmanyboats.today" &&
    url.pathname === "/";
  const pathname = isHowManyBoatsRoot ? "/today" : url.pathname;
  const candidates = PUBLIC_SSR_ROUTE_MANIFEST.map((route) => ({
    route,
    params: matchPattern(route, pathname),
  }))
    .filter(
      (
        item
      ): item is {
        route: PublicSsrRouteDefinition;
        params: PublicSsrRouteParams;
      } => Boolean(item.params)
    )
    .sort((a, b) => staticWeight(b.route.path) - staticWeight(a.route.path));
  // A terminal-shaped path needs the catalog resolver to determine whether it
  // is invalid or simply unknown to this caller. Do not guess at this layer.
  const concreteCandidate = candidates.find(
    (candidate) => candidate.route.kind !== "not-found"
  );
  if (!resolver && concreteCandidate?.params.terminalSlug) {
    return undefined;
  }
  const candidate = candidates.find((candidate) => {
    if (!candidate.params.terminalSlug) {
      return true;
    }
    if (!resolver) {
      return false;
    }
    const terminal = resolver.resolveSlug(candidate.params.terminalSlug);
    if (!terminal) {
      return false;
    }
    candidate.params.terminalSlug = terminal.slug;
    if (!candidate.params.mateSlug) {
      return true;
    }
    const mate = resolver.resolveSlug(candidate.params.mateSlug);
    if (!mate || !terminal.mateSlugs?.includes(mate.slug)) {
      return false;
    }
    candidate.params.mateSlug = mate.slug;
    return true;
  });
  if (!candidate) {
    return undefined;
  }
  if (candidate.route.kind === "not-found") {
    return {
      canonicalPath: "/404",
      params: {},
      query: { rejected: [], values: {} },
      route: candidate.route,
      routePath: "/404",
    };
  }
  const segments = candidate.route.path.split("/").filter(Boolean);
  const resolvedSegments = segments.map((segment) => {
    if (!segment.startsWith(":")) {
      return segment;
    }
    return candidate.params[segment.slice(1) as keyof PublicSsrRouteParams];
  });
  const routePath =
    resolvedSegments.length === 0 ? "/" : `/${resolvedSegments.join("/")}`;
  return {
    canonicalPath: isHowManyBoatsRoot ? "/" : routePath,
    params: candidate.params,
    query: normalizePublicQuery(candidate.route, url.searchParams),
    route: candidate.route,
    routePath,
  };
};
export const assertPublicSsrRouteCoherence = (
  input: {
    canonicalHost: "ferry.fyi" | "howmanyboats.today";
    canonicalPath: string;
    query: Readonly<Record<string, string>>;
    routeId: PublicSsrRouteId;
    routeParams: PublicSsrRouteParams;
  },
  resolver?: PublicSsrTerminalResolver
): void => {
  const expectedRoutePath =
    input.canonicalHost === "howmanyboats.today" &&
    input.routeId === "today" &&
    input.canonicalPath === "/"
      ? "/today"
      : input.canonicalPath;
  const match = matchPublicSsrRoute(
    new URL(
      `https://${input.canonicalHost}${input.canonicalPath}?${new URLSearchParams(input.query)}`
    ),
    resolver
  );
  if (
    !match ||
    match.route.id !== input.routeId ||
    match.canonicalPath !== input.canonicalPath ||
    match.routePath !== expectedRoutePath ||
    JSON.stringify(match.params) !== JSON.stringify(input.routeParams) ||
    match.query.rejected.length ||
    JSON.stringify(match.query.values) !== JSON.stringify(input.query)
  ) {
    throw new Error("Invalid public SSR snapshot coherence");
  }
};
