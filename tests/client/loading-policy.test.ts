import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = (path: string): string => readFileSync(path, "utf8");

describe("loading-state source policy", () => {
  it("restricts animated waves to the Splash bootstrap component", () => {
    const splash = source("client/components/Splash.tsx");
    const componentFiles = [
      "client/App.tsx",
      "client/views/Route.tsx",
      "client/views/Tickets/index.tsx",
      "client/views/Home.tsx",
      "client/views/Cameras.tsx",
      "client/views/Schedule/index.tsx",
      "client/views/Fares.tsx",
    ];

    expect(splash).toContain('import { LoadingWaves } from "./LoadingWaves"');
    expect(splash).toContain('<LoadingWaves className="mt-8" />');
    componentFiles.forEach((path) => {
      expect(source(path)).not.toContain("LoadingWaves");
    });
  });

  it("keeps Splash fallbacks at application bootstrap boundaries", () => {
    const app = source("client/App.tsx");
    const route = source("client/views/Route.tsx");
    const tickets = source("client/views/Tickets/index.tsx");

    expect(app).toContain(
      "<Suspense fallback={<AppLoadingState />}>{element}</Suspense>"
    );
    const routes = source("client/routes.tsx");
    expect(routes).toContain('case "callback":');
    expect(routes).toContain("return <Splash />;");
    expect(route).toContain(
      "fallback={<RouteLoadingState hasRouteFooter view={view} />}"
    );
    expect(route).not.toContain(
      "<Suspense fallback={<Splash />}>{content}</Suspense>"
    );
    expect(tickets).toContain(
      "<Suspense fallback={<TicketOverlayLoadingState />}>"
    );
    expect(tickets).toContain("return <TicketsLoadingState />;");
  });

  it("keeps route view imports lazy while data resolution uses RouteLoadingState", () => {
    const route = source("client/views/Route.tsx");

    const lazyViews = [
      ["AlertSubscription", "./AlertSubscription"],
      ["Bulletins", "./Bulletins"],
      ["Cameras", "./Cameras"],
      ["Fares", "./Fares"],
      ["Map", "./Map"],
      ["Schedule", "./Schedule"],
      ["TerminalDetails", "./TerminalDetails"],
    ];

    lazyViews.forEach(([view, module]) => {
      expect(route).toContain(`const load${view} = () =>`);
      expect(route).toContain(`const ${view} = React.lazy(load${view});`);
      expect(route).toContain(`import("${module}")`);
      expect(route).not.toMatch(
        new RegExp(`^import\\s+.*${module.replace(".", "\\.")}`, "m")
      );
    });
    expect(route).toContain("RouteLoadingState");
    expect(route).toContain("<RouteLoadingState view={view} />");

    const loadingState = source("client/components/RouteLoadingState.tsx");
    expect(loadingState).not.toMatch(/(?:import|export).*views\//);
    expect(loadingState).toContain(
      'import type { RouteView } from "~/lib/routeViews"'
    );
  });

  it("removes the obsolete generic InlineLoader source", () => {
    expect(existsSync("client/components/InlineLoader.tsx")).toBe(false);
    expect(source("client/App.tsx")).not.toContain("InlineLoader");
    expect(source("client/views/Route.tsx")).not.toContain("InlineLoader");
  });

  it("gives a failed initial schedule load precedence over its skeleton", () => {
    const schedule = source("client/views/Schedule/index.tsx");
    const errorGuard = schedule.indexOf("if (loadError && !schedule?.slots)");
    const loadingGuard = schedule.indexOf("if (!schedule?.slots)");

    expect(errorGuard).toBeGreaterThan(-1);
    expect(loadingGuard).toBeGreaterThan(errorGuard);
    expect(schedule).toContain('title="Schedule could not load"');
    expect(schedule).toContain("return <ScheduleLoadingSkeleton />;");
  });

  it("keys leaderboard rank content by entity scope and selected period", () => {
    const leaderboards = source("client/views/Leaderboards.tsx");

    expect(leaderboards).toContain("key={leaderboardKey(terminalId, period)}");
    expect(leaderboards).toContain("key={leaderboardKey(vesselId, period)}");
    expect(leaderboards).toContain(
      "selectedPeriod?.entityId === terminalId ? selectedPeriod.period : null"
    );
    expect(leaderboards).toContain(
      "selectedPeriod?.entityId === vesselId ? selectedPeriod.period : null"
    );
  });

  it("distinguishes account bootstrap failure, bootstrap loading, and retained-data errors", () => {
    const account = source("client/views/Account.tsx");

    expect(account).toContain("if (!accountUser && userError)");
    expect(account).toContain('title="Account could not load"');
    expect(account).toContain("if (!accountUser && isUserLoading) {");
    expect(account).toContain("return <AccountLoadingState />;");
    expect(account).toContain("Existing account");
    expect(account.indexOf("if (!accountUser && userError)")).toBeLessThan(
      account.indexOf("if (!accountUser && isUserLoading) {")
    );
  });

  it("uses alert skeletons while auth or account data is unresolved and keeps errors distinct", () => {
    const alerts = source("client/views/AlertSubscription.tsx");

    expect(alerts).toContain(
      "if (isLoading || (!isAuthenticated && !loginError))"
    );
    expect(alerts).toContain("if (!user && isUserLoading)");
    expect(
      alerts.match(/return <AlertSubscriptionLoadingState \/>;/g)
    ).toHaveLength(2);
  });

  it("marks only manual camera reloads busy and keeps polled freshness passive", () => {
    const cameras = source("client/views/Cameras.tsx");

    expect(cameras).toContain("isReloading={manualRefreshCount > 0}");
    expect(cameras).toContain("passive");
  });

  it("uses page-specific skeletons for Today, Admin, and Fares", () => {
    const today = source("client/views/Today.tsx");
    const admin = source("client/views/Admin.tsx");
    const fares = source("client/views/Fares.tsx");

    expect(today).toContain('label="Loading today\'s boat count"');
    expect(admin).toContain("loadingFallback: ReactNode");
    expect(admin).toContain("if (!active || loaded || !load || error)");
    expect(fares.indexOf("const header =")).toBeLessThan(
      fares.indexOf("if (isLoadingCatalog)")
    );
    expect(fares).toContain('label="Loading fare estimator"');
  });
});
