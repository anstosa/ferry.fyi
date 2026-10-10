import { DateTime } from "luxon";
import type { Camera } from "shared/contracts/cameras";
import type { Terminal } from "shared/contracts/terminals";
import TERMINAL_CATALOG from "shared/data/terminals.json";
import { getRecommendationServiceDate } from "shared/lib/sailingRecommendationRevision";
import { normalizePublicQuery } from "shared/lib/ssrQueryPolicy";
import {
  createStaticPublicSsrTerminalResolver,
  matchPublicSsrRoute,
} from "shared/lib/ssrRouteMatch";
import { compareTerminalsByName } from "shared/lib/terminalSorting";

import type { OverviewTerminal } from "~/components/TerminalOverview";
import type { RouteView } from "~/lib/routeViews";

type LoadingTerminal = OverviewTerminal & {
  bulletins?: Terminal["bulletins"];
  cameras?: Camera[];
  routes?: Terminal["routes"];
};

export interface RouteLoadingContext {
  mate?: LoadingTerminal;
  selectedDate: string;
  terminal: LoadingTerminal;
  view: RouteView;
}

const resolver = createStaticPublicSsrTerminalResolver();
// index only stable identities, never bundled live reports or provider prose
const catalogBySlug = Object.fromEntries(
  Object.entries(TERMINAL_CATALOG).map(([id, entry]) => [
    entry.slug,
    { ...entry, id },
  ])
);

// render dock identity immediately while its current API facts are unresolved
const getLoadingTerminal = (slug: string): LoadingTerminal => {
  const entry = catalogBySlug[slug];
  // keep the API's alphabetical default destination without loading its directory
  const mates = (resolver.resolveSlug(slug)?.mateSlugs ?? [])
    .map((mateSlug) => {
      const mate = catalogBySlug[mateSlug];
      return { abbreviation: mate.abbreviation, id: mate.id, name: mate.name };
    })
    .sort(compareTerminalsByName);
  return {
    abbreviation: entry.abbreviation,
    id: entry.id,
    mates,
    name: entry.name,
  };
};

// resolve loading labels and links with the same validated topology as public routes
export const getRouteLoadingContext = (
  pathname: string,
  search = "",
  now = Date.now()
): RouteLoadingContext | null => {
  const match = matchPublicSsrRoute(
    new URL(`${pathname}${search}`, "http://localhost"),
    resolver
  );
  // private, unknown and unrelated routes keep their ordinary app loading boundary
  if (!match?.params.terminalSlug || !match.route.view) {
    return null;
  }
  const terminal = getLoadingTerminal(match.params.terminalSlug);
  const mateSlug =
    match.params.mateSlug ??
    (terminal.mates?.[0]
      ? resolver.resolveSlug(terminal.mates[0].id)?.slug
      : undefined);
  // browser tabs retain service dates even when their anonymous canonical URL omits them
  const dateQuery = normalizePublicQuery(
    { allowedQuery: ["date"] },
    new URLSearchParams(search)
  );
  const requestedDate = DateTime.fromISO(dateQuery.values.date ?? "", {
    zone: "America/Los_Angeles",
  });
  return {
    mate: mateSlug ? getLoadingTerminal(mateSlug) : undefined,
    selectedDate:
      requestedDate.toISODate() ?? getRecommendationServiceDate(now / 1000),
    terminal,
    view: match.route.view,
  };
};
