import React, { lazy, type ReactElement } from "react";
import { Navigate, type RouteObject, useRoutes } from "react-router-dom";
import type { PublicSsrRouteDefinition } from "shared/contracts/ssr";
import { getNotFoundSeoMetadata, getSeoMetadata } from "shared/lib/seo";
import {
  getPublicSsrHostProfile,
  type PublicSsrHostProfile,
} from "shared/lib/ssrRouteMatch";
import { PUBLIC_SSR_ROUTE_MANIFEST } from "shared/lib/ssrRoutes";

import { SeoHelmet } from "~/components/SeoHelmet";
import { Splash } from "~/components/Splash";
import { useAppRenderContext } from "~/lib/renderContext";
import type { RouteView } from "~/lib/routeViews";
import { usePublicSsrSnapshot } from "~/lib/ssrSeed";
import { About } from "~/views/About";
import {
  PublicAlertGuidance,
  PublicBulletins,
  PublicCameras,
  PublicEditorialPage,
  PublicFares,
  PublicHome,
  PublicLeaderboards,
  PublicRouteMap,
  PublicSchedule,
  PublicTerminalDetails,
  PublicTickets,
} from "~/views/PublicSsrPages";
import { Today } from "~/views/Today";

const loadAdmin = () =>
  import("~/views/Admin").then(({ Admin }) => ({ default: Admin }));
const Admin = lazy(loadAdmin);
const loadAccount = () =>
  import("~/views/Account").then(({ Account }) => ({ default: Account }));
const Account = lazy(loadAccount);
// ios migration route loader
const loadIosMigration = () =>
  import("~/views/IosMigration").then(({ IosMigration }) => ({
    default: IosMigration,
  }));
const IosMigration = lazy(loadIosMigration);
// login route loader
const loadLogin = () =>
  import("~/views/Login").then(({ Login }) => ({ default: Login }));
const Login = lazy(loadLogin);
// logout route loader
const loadLogout = () =>
  import("~/views/Logout").then(({ Logout }) => ({ default: Logout }));
const Logout = lazy(loadLogout);
const loadDataSources = () =>
  import("~/views/DataSources").then(({ DataSources }) => ({
    default: DataSources,
  }));
const DataSources = lazy(loadDataSources);
const loadFeedback = () =>
  import("~/views/Feedback").then(({ Feedback }) => ({ default: Feedback }));
const Feedback = lazy(loadFeedback);
const loadForecastingExplained = () =>
  import("~/views/ForecastingExplained").then(({ ForecastingExplained }) => ({
    default: ForecastingExplained,
  }));
const ForecastingExplained = lazy(loadForecastingExplained);
const loadHome = () =>
  import("~/views/Home").then(({ Home }) => ({ default: Home }));
const Home = lazy(loadHome);
const loadLeaderboards = () =>
  import("~/views/Leaderboards").then(({ Leaderboards }) => ({
    default: Leaderboards,
  }));
const Leaderboards = lazy(loadLeaderboards);
const loadPrivacyPolicy = () =>
  import("~/views/PrivacyPolicy").then(({ PrivacyPolicy }) => ({
    default: PrivacyPolicy,
  }));
const PrivacyPolicy = lazy(loadPrivacyPolicy);
const loadRoute = () =>
  import("~/views/Route").then(({ Route }) => ({ default: Route }));
const Route = lazy(loadRoute);
const loadTickets = () =>
  import("~/views/Tickets").then(({ Tickets }) => ({ default: Tickets }));
const Tickets = lazy(loadTickets);

/** Preload the browser-only view before replacing the seeded document tree. */
export const preloadBrowserRoute = async (
  pathname: string,
  hostProfile: PublicSsrHostProfile = "ferry.fyi"
): Promise<void> => {
  if (pathname === "/" && hostProfile === "howmanyboats.today") {
    return;
  }
  if (pathname === "/") {
    await loadHome();
    return;
  }
  if (pathname === "/today") {
    return;
  }
  if (pathname === "/tickets") {
    await loadTickets();
    return;
  }
  if (pathname === "/account") {
    await loadAccount();
    return;
  }
  if (pathname === "/ios") {
    await loadIosMigration();
    return;
  }
  if (pathname === "/login") {
    await loadLogin();
    return;
  }
  if (pathname === "/logout") {
    await loadLogout();
    return;
  }
  if (pathname === "/admin") {
    await loadAdmin();
    return;
  }
  if (pathname.startsWith("/leaderboards")) {
    await loadLeaderboards();
    return;
  }
  if (pathname === "/about") {
    return;
  }
  if (pathname === "/data-sources") {
    await loadDataSources();
    return;
  }
  if (pathname === "/privacy") {
    await loadPrivacyPolicy();
    return;
  }
  if (pathname === "/forecasting" || pathname === "/forecasting-explained") {
    await loadForecastingExplained();
    return;
  }
  if (pathname === "/feedback") {
    await loadFeedback();
    return;
  }
  if (
    /^\/[^/]+(?:\/[^/]+)?(?:\/(?:cameras|terminal|fare|map|alerts|subscribe))?\/?$/.test(
      pathname
    )
  ) {
    const route = await import("~/views/Route");
    await route.preloadRouteView(pathname);
  }
};

export type RouteBoundary = (
  label: string,
  element: ReactElement
) => ReactElement;

export type AppRouteMode = "browser" | "universal";

const browserRouteElement = (route: PublicSsrRouteDefinition): ReactElement => {
  if (route.view) {
    return <Route view={route.view as RouteView} />;
  }

  switch (route.id) {
    case "home":
      return <Home />;
    case "today":
      return <Today />;
    case "callback":
      return <Splash />;
    case "account":
      return <Account />;
    case "ios-migration":
      return <IosMigration />;
    case "login":
      return <Login />;
    case "logout":
      return <Logout />;
    case "tickets":
      return <Tickets />;
    case "about":
      return <About />;
    case "admin":
      return <Admin />;
    case "leaderboards":
    case "leaderboards-settings":
    case "leaderboards-terminal":
    case "leaderboards-vessel":
    case "leaderboards-unmatched":
      return <Leaderboards />;
    case "data-sources":
      return <DataSources />;
    case "privacy":
      return <PrivacyPolicy />;
    case "forecasting":
      return <ForecastingExplained />;
    case "forecasting-explained":
      return <Navigate replace to="/forecasting" />;
    case "feedback":
      return <Feedback />;
    case "unknown-public-path":
      return <NotFound />;
    default:
      throw new Error(`No client element for route: ${route.id}`);
  }
};

const ClientOnlyPlaceholder = (): ReactElement => (
  <>
    <SeoHelmet
      seo={{
        ...getSeoMetadata("/"),
        canonicalPath: "/",
        robots: "noindex,follow",
      }}
    />
    <main aria-label="Client-only page" data-robots="noindex,follow" />
  </>
);

const notFoundSeo = getNotFoundSeoMetadata();

/** Request-neutral fallback rendered by both browser and universal route trees. */
const NotFound = (): ReactElement => (
  <>
    <SeoHelmet seo={notFoundSeo} />
    <main aria-labelledby="not-found-title">
      <h1 id="not-found-title">Page not found</h1>
      <p>The requested Ferry FYI page could not be found.</p>
    </main>
  </>
);

const universalRouteElement = (
  route: PublicSsrRouteDefinition
): ReactElement => {
  if (route.placeholder === "client-only" || route.kind === "private") {
    return <ClientOnlyPlaceholder />;
  }
  if (route.kind === "not-found") {
    return <NotFound />;
  }
  if (route.id === "home") {
    return <PublicHome />;
  }
  if (
    route.id === "data-sources" ||
    route.id === "privacy" ||
    route.id === "forecasting" ||
    route.id === "feedback"
  ) {
    return <PublicEditorialPage page={route.id} />;
  }
  if (route.view === "subscribe") {
    return <PublicAlertGuidance />;
  }
  if (route.view === "map") {
    return <PublicRouteMap />;
  }
  if (route.view === "fare") {
    return <PublicFares />;
  }
  if (route.view === "schedule") {
    return <PublicSchedule />;
  }
  if (route.view === "cameras") {
    return <PublicCameras />;
  }
  if (route.view === "alerts") {
    return <PublicBulletins />;
  }
  if (route.view === "terminal") {
    return <PublicTerminalDetails />;
  }
  // About is currently the only public view whose module boundary is free of
  // browser-only SDK imports. Other public views are activated once their
  // browser effects have an equivalent universal split.
  switch (route.id) {
    case "today":
      return <Today />;
    case "about":
      return <About />;
    case "tickets":
      return <PublicTickets />;
    case "leaderboards":
    case "leaderboards-terminal":
    case "leaderboards-vessel":
      return <PublicLeaderboards />;
    default:
      return <ClientOnlyPlaceholder />;
  }
};

const routeElement = (
  route: PublicSsrRouteDefinition,
  mode: AppRouteMode
): ReactElement =>
  mode === "browser"
    ? browserRouteElement(route)
    : universalRouteElement(route);

const routeForHostProfile = (
  route: PublicSsrRouteDefinition,
  hostProfile: PublicSsrHostProfile
): PublicSsrRouteDefinition => {
  if (hostProfile !== "howmanyboats.today" || route.id !== "home") {
    return route;
  }
  return (
    PUBLIC_SSR_ROUTE_MANIFEST.find((candidate) => candidate.id === "today") ??
    route
  );
};

const BrowserHostProfileRoot = (): ReactElement => {
  const { seoHost } = useAppRenderContext();
  const homeRoute = PUBLIC_SSR_ROUTE_MANIFEST.find(
    (route) => route.id === "home"
  );
  if (!homeRoute) {
    return <NotFound />;
  }
  return browserRouteElement(
    routeForHostProfile(
      homeRoute,
      getPublicSsrHostProfile(seoHost) ?? "ferry.fyi"
    )
  );
};

/** Build both browser and universal routes from the sole shared manifest. */
export const createAppRoutes = (
  withBoundary: RouteBoundary,
  mode: AppRouteMode = "browser",
  hostProfile?: PublicSsrHostProfile
): RouteObject[] =>
  PUBLIC_SSR_ROUTE_MANIFEST.filter(
    (route) =>
      mode === "universal" ||
      route.browserMount === true ||
      !route.id.startsWith("leaderboards")
  ).map((route) => {
    const activeRoute = hostProfile
      ? routeForHostProfile(route, hostProfile)
      : route;
    const element =
      mode === "browser" && route.id === "home" && !hostProfile ? (
        <BrowserHostProfileRoot />
      ) : (
        routeElement(activeRoute, mode)
      );
    return {
      element:
        mode === "browser" && activeRoute.kind !== "redirect"
          ? withBoundary(activeRoute.boundaryLabel, element)
          : element,
      path: route.path,
    };
  });

/** Routes for browser-neutral document rendering; policy still comes from the
 * single shared manifest used by the browser route table above. */
export const UniversalRoutes = (): ReactElement | null => {
  const snapshot = usePublicSsrSnapshot();
  const routes = useRoutes(
    createAppRoutes(
      (_label, element) => element,
      "universal",
      snapshot?.hostProfile
    )
  );
  return snapshot?.routeId === "unknown-public-path" ? <NotFound /> : routes;
};
