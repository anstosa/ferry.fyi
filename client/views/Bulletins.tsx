import clsx from "clsx";
import { DateTime } from "luxon";
import React, {
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { type Bulletin, Level } from "shared/contracts/bulletins";
import type { Route } from "shared/contracts/routes";
import type { Terminal } from "shared/contracts/terminals";
import { isRuleForRoute } from "shared/lib/alertSubscriptions";
import { getRecommendationServiceDate } from "shared/lib/sailingRecommendationRevision";

import {
  AlertsLoadingContent,
  AlertsResultsSkeleton,
} from "~/components/AlertsLoadingContent";
import { AlertsOverview } from "~/components/AlertsOverview";
import { FreshnessPill } from "~/components/FreshnessPill";
import { HeaderDropdown } from "~/components/HeaderDropdown";
import { NotificationPermissionWarning } from "~/components/NotificationPermissionWarning";
import { Toast } from "~/components/Toast";
import { getBulletinTime, getRouteBulletins } from "~/lib/bulletins";
import type { GetPath } from "~/lib/routeViews";
import { getPublicSsrSourceOutcome, usePublicSsrSnapshot } from "~/lib/ssrSeed";
import { getSlug, refreshBulletins, useTerminals } from "~/lib/terminals";
import { useUsefulContent } from "~/lib/usefulVisits";
import { useUser } from "~/lib/user";
import UnsubscribedIcon from "~/static/images/icons/regular/bell.svg";
import SubscribedIcon from "~/static/images/icons/solid/bell.svg";
import BellAlertIcon from "~/static/images/icons/solid/bell-exclamation.svg";
import WarningIcon from "~/static/images/icons/solid/exclamation-triangle.svg";
import InfoIcon from "~/static/images/icons/solid/info-circle.svg";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";

import { Header } from "./Header";

interface RouteOption {
  mate: Terminal;
  route: Route;
  terminal: Terminal;
}

interface BulletinLevelStyles {
  badge: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
}

const getBulletinLevelStyles = (level: Level): BulletinLevelStyles => {
  // distinguish high-impact alerts from ordinary advisories
  if (level === Level.HIGH) {
    return {
      badge:
        "border-stale-light text-stale-dark dark:border-stale-dark dark:text-[#ffb3b0]",
      Icon: WarningIcon,
      label: "High impact",
    };
  }
  return {
    badge:
      "border-blue-dark text-blue-dark dark:border-[#6fb8c8] dark:text-[#b8e4f0]",
    Icon: InfoIcon,
    label: "Advisory",
  };
};

const getRouteOptions = (terminals: Terminal[]): RouteOption[] => {
  const terminalsById = Object.fromEntries(
    terminals.map((terminal) => [terminal.id, terminal])
  );
  const routesById = new Map<string, RouteOption>();
  terminals.forEach((terminal) => {
    Object.values(terminal.routes ?? {}).forEach((route) => {
      if (routesById.has(route.id)) {
        return;
      }
      const routeTerminals = route.terminalIds
        .map((terminalId) => terminalsById[terminalId])
        .filter((terminal): terminal is Terminal => Boolean(terminal));
      if (routeTerminals.length < 2) {
        return;
      }
      routesById.set(route.id, {
        mate: routeTerminals[1],
        route,
        terminal: routeTerminals[0],
      });
    });
  });
  return Array.from(routesById.values()).sort((left, right) =>
    left.route.description.localeCompare(right.route.description)
  );
};

interface SubscribeLinkProps {
  getPath: GetPath;
  mate: Terminal | null;
  terminal: Terminal;
}

const SubscribeLink = ({
  getPath,
  mate,
  terminal,
}: SubscribeLinkProps): ReactElement => {
  const [{ alertRules }] = useUser();
  const terminalIds = mate ? [terminal.id, mate.id] : [terminal.id];
  const isSubscribed =
    alertRules?.some((rule) => isRuleForRoute(rule, terminalIds)) ?? false;
  const label = isSubscribed ? "Edit alerts" : "Set up alerts";

  return (
    <Link
      className="button button-primary w-fit"
      to={getPath({ view: "subscribe" })}
    >
      <div className="button-icon">
        {isSubscribed ? <SubscribedIcon /> : <UnsubscribedIcon />}
      </div>
      <span className="button-label">{label}</span>
    </Link>
  );
};

interface Props {
  getPath: GetPath;
  mate: Terminal | null;
  onTerminalRefresh?: (terminal: Terminal) => void;
  setRoute: (target: string, mate?: string) => void;
  terminal: Terminal | null;
  time: DateTime;
}

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

function snapshotTimestamp(
  source:
    | {
        observedAt: string;
        sourceUpdatedAt: string | null;
      }
    | undefined
): number | null {
  if (!source) {
    return null;
  }
  const timestamp = Date.parse(source.sourceUpdatedAt ?? source.observedAt);
  return Number.isFinite(timestamp) ? timestamp / 1000 : null;
}

export const Bulletins = ({
  getPath,
  mate,
  onTerminalRefresh,
  setRoute,
  terminal,
  time,
}: Props): ReactElement => {
  const location = useLocation();
  const snapshot = usePublicSsrSnapshot();
  const initialTerminalRef = useRef(terminal);
  const activeTerminalIdRef = useRef(terminal?.id);
  activeTerminalIdRef.current = terminal?.id;
  const { terminals } = useTerminals();
  const [isRouteOpen, setRouteOpen] = useState<boolean>(false);
  const terminalSlug = terminal ? getSlug(terminal.id) : undefined;
  const mateSlug = mate ? getSlug(mate.id) : undefined;
  const seededRoutePath = terminalSlug
    ? `/${terminalSlug}${
        snapshot?.routeParams.mateSlug
          ? `/${snapshot.routeParams.mateSlug}`
          : ""
      }/alerts`
    : undefined;
  const hasMatchingSeedRoute =
    terminalSlug !== undefined &&
    snapshot !== undefined &&
    normalizePath(location.pathname) === seededRoutePath &&
    snapshot.routeParams.terminalSlug === terminalSlug &&
    (!snapshot.routeParams.mateSlug ||
      snapshot.routeParams.mateSlug === mateSlug) &&
    snapshot.routeId ===
      (snapshot.routeParams.mateSlug ? "mate-alerts" : "terminal-alerts");
  const seededBulletinsOutcome = hasMatchingSeedRoute
    ? getPublicSsrSourceOutcome(snapshot, "bulletins")
    : undefined;
  const seededBulletins =
    seededBulletinsOutcome?.outcome === "value" ||
    seededBulletinsOutcome?.outcome === "empty" ||
    seededBulletinsOutcome?.outcome === "stale-usable"
      ? seededBulletinsOutcome.value
      : undefined;
  const seededSourceUpdatedAt =
    seededBulletins === undefined
      ? null
      : snapshotTimestamp(seededBulletinsOutcome);
  const routeKey = `${normalizePath(location.pathname)}:${terminal?.id ?? ""}:${
    mate?.id ?? ""
  }`;
  const activeRouteKeyRef = useRef(routeKey);
  activeRouteKeyRef.current = routeKey;
  const [refreshState, setRefreshState] = useState<{
    routeKey: string;
    sourceUpdatedAt: number | null;
    terminal: Terminal | null;
  }>(() => ({
    routeKey,
    sourceUpdatedAt: seededSourceUpdatedAt,
    terminal: null,
  }));
  const currentRefreshState =
    refreshState.routeKey === routeKey
      ? refreshState
      : {
          routeKey,
          sourceUpdatedAt: seededSourceUpdatedAt,
          terminal: null,
        };
  const [isRefreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [failedRefreshRouteKey, setFailedRefreshRouteKey] = useState<
    string | null
  >(null);
  const routeOptions = getRouteOptions(terminals);
  const [{ alertRules }] = useUser();

  useEffect(() => {
    setRefreshState({
      routeKey,
      sourceUpdatedAt: seededSourceUpdatedAt,
      terminal: null,
    });
    setRefreshing(false);
    setRefreshError(false);
    setFailedRefreshRouteKey(null);
  }, [routeKey, seededSourceUpdatedAt]);
  useEffect(() => {
    const terminalId = terminal?.id;
    if (!terminalId) {
      return;
    }
    let isCurrent = true;
    refreshBulletins(terminalId)
      .then((result) => {
        // accept only the response for the route still on screen
        if (
          isCurrent &&
          activeRouteKeyRef.current === routeKey &&
          activeTerminalIdRef.current === terminalId
        ) {
          setRefreshState({
            routeKey,
            sourceUpdatedAt: result.sourceUpdatedAt,
            terminal: result.terminal,
          });
          onTerminalRefresh?.(result.terminal);
          setFailedRefreshRouteKey(null);
        }
      })
      .catch((error) => {
        // settle a failed initial request without claiming an all-clear
        if (
          isCurrent &&
          activeRouteKeyRef.current === routeKey &&
          activeTerminalIdRef.current === terminalId
        ) {
          setFailedRefreshRouteKey(routeKey);
        }
        console.error(error);
      });
    return () => {
      isCurrent = false;
    };
  }, [onTerminalRefresh, routeKey, terminal?.id]);

  const hasLiveBulletins = Boolean(
    terminal && currentRefreshState.terminal?.id === terminal.id
  );
  const hasUsableSeededBulletins = Boolean(
    terminal &&
    seededBulletins !== undefined &&
    terminal === initialTerminalRef.current
  );
  const hasCurrentSeededBulletins = Boolean(
    hasUsableSeededBulletins &&
    (seededBulletinsOutcome?.outcome === "value" ||
      seededBulletinsOutcome?.outcome === "empty")
  );
  const hasUsableBulletins = hasLiveBulletins || hasUsableSeededBulletins;
  const hasCurrentBulletinStatus =
    hasLiveBulletins || hasCurrentSeededBulletins;
  const usefulContentRef = useUsefulContent(
    "bulletins",
    routeKey,
    hasUsableBulletins
  );

  // loading defaults are not a confirmed all-clear outcome
  if (!terminal) {
    return <BulletinsLoadingSkeleton />;
  }
  let displayTerminal = terminal;
  if (currentRefreshState.terminal?.id === terminal.id) {
    displayTerminal = currentRefreshState.terminal;
  } else if (
    seededBulletins !== undefined &&
    terminal === initialTerminalRef.current
  ) {
    displayTerminal = { ...terminal, bulletins: [...seededBulletins] };
  }
  const { sourceUpdatedAt } = currentRefreshState;

  const selectedRoute = mate
    ? Object.values(displayTerminal.routes ?? {}).find(
        (route) =>
          route.terminalIds.includes(displayTerminal.id) &&
          route.terminalIds.includes(mate.id)
      )
    : undefined;
  const routeName =
    selectedRoute?.description ??
    (mate ? `${displayTerminal.name} / ${mate.name}` : displayTerminal.name);
  const routeShortName = selectedRoute?.abbreviation ?? routeName;
  const activeBulletins = getRouteBulletins(displayTerminal, mate);
  const alertCount = activeBulletins.length;
  const hasUnavailableSeed =
    !hasLiveBulletins &&
    seededBulletinsOutcome?.outcome === "authoritatively-unavailable";
  const alertsUnavailable =
    !hasCurrentBulletinStatus &&
    (failedRefreshRouteKey === routeKey || hasUnavailableSeed);
  let alertSummary = alertsUnavailable
    ? "Current WSF alert status is unavailable"
    : "Checking current WSF service alerts";
  // report an all-clear only after a current source result settles
  if (hasCurrentBulletinStatus && alertCount === 0) {
    alertSummary = "No active service alerts right now";
  }
  // distinguish current results from unconfirmed saved alerts
  if (alertCount > 0) {
    const alertNoun = alertCount === 1 ? "alert" : "alerts";
    // current source data can be labeled active
    if (hasCurrentBulletinStatus) {
      alertSummary = `${alertCount} active ${alertNoun} from WSF`;
    } else if (alertsUnavailable) {
      // saved alerts remain visible with an explicit unavailable warning
      alertSummary = `${alertCount} saved ${alertNoun}; current status unavailable`;
    } else {
      // saved alerts stay visible while the current request is pending
      alertSummary = `${alertCount} saved ${alertNoun}; checking for updates`;
    }
  }
  const hasConfiguredAlerts = (alertRules ?? []).some((rule) =>
    isRuleForRoute(
      rule,
      mate ? [displayTerminal.id, mate.id] : [displayTerminal.id]
    )
  );

  const refresh = async (): Promise<void> => {
    const terminalId = displayTerminal.id;
    const isCurrentRequest = (): boolean =>
      activeRouteKeyRef.current === routeKey &&
      activeTerminalIdRef.current === terminalId;
    setRefreshing(true);
    setRefreshError(false);
    try {
      const result = await refreshBulletins(terminalId);
      // accept only the manual response for the route still on screen
      if (isCurrentRequest()) {
        setRefreshState({
          routeKey,
          sourceUpdatedAt: result.sourceUpdatedAt,
          terminal: result.terminal,
        });
        onTerminalRefresh?.(result.terminal);
        setFailedRefreshRouteKey(null);
      }
    } catch (error) {
      // expose the error only while this route remains active
      if (isCurrentRequest()) {
        setRefreshError(true);
        setFailedRefreshRouteKey(routeKey);
      }
      throw error;
    } finally {
      if (isCurrentRequest()) {
        setRefreshing(false);
      }
    }
  };

  // render bulletin details without a redundant alerts-page shortcut
  const renderBulletin = (bulletin: Bulletin): ReactNode => {
    const { bodyText, date, level, routePrefix, title } = bulletin;
    const { badge, Icon, label } = getBulletinLevelStyles(level);
    const bulletinTime = DateTime.fromSeconds(date, {
      zone: "America/Los_Angeles",
    });
    return (
      <li
        className="border-b border-black/10 py-4 last:border-b-0 dark:border-white/10"
        key={`${date}:${title}`}
      >
        <article>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 font-bold",
                badge
              )}
            >
              <Icon aria-hidden="true" className="h-3 w-3" />
              {label}
            </span>
            <time
              className="font-semibold text-gray-600 dark:text-gray-300"
              dateTime={bulletinTime.toISO() ?? undefined}
            >
              {getBulletinTime(bulletin, time)}
            </time>
            {routePrefix !== "All" && (
              <span className="font-semibold text-blue-dark dark:text-[#b8e4f0]">
                {routePrefix}
              </span>
            )}
          </div>
          <h3 className="text-lg font-bold leading-snug text-gray-darkest dark:text-white">
            {title}
          </h3>
          <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-gray-dark dark:text-[#e0f0f4]">
            {bodyText}
          </p>
        </article>
      </li>
    );
  };

  return (
    <>
      <Header
        share={{
          shareSurface: "bulletins",
          shareButtonText: "Share Alerts",
          sharedText: `Alerts for ${routeName}`,
        }}
        items={[
          ...(displayTerminal.terminalUrl
            ? [
                {
                  Icon: WSDOTIcon,
                  label: "WSF Alerts Page",
                  url: displayTerminal.terminalUrl,
                  isBottom: true,
                },
              ]
            : []),
        ]}
      >
        <div className="min-w-0 flex-1" />
        <div className="min-w-0 text-center">
          <HeaderDropdown
            ariaLabel="Expand routes"
            getKey={(option) => option.route.id}
            getLabel={(option) => option.route.description}
            getShortLabel={(option) => option.route.abbreviation}
            isOpen={isRouteOpen}
            onSelect={(event, option) => {
              event.preventDefault();
              setRouteOpen(false);
              setRoute(getSlug(option.terminal.id), getSlug(option.mate.id));
            }}
            options={routeOptions}
            selectedLabel={routeName}
            selectedShortLabel={routeShortName}
            setOpen={setRouteOpen}
          />
        </div>
        <span className="ml-2 shrink-0">Alerts</span>
        <div className="min-w-0 flex-1" />
      </Header>
      <main
        id="main"
        className="flex-grow overflow-y-scroll scrolling-touch bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]"
      >
        <section ref={usefulContentRef} className="mx-auto w-full max-w-6xl">
          <AlertsOverview
            mate={mate}
            selectedDate={getRecommendationServiceDate(time.toSeconds())}
            terminal={displayTerminal}
          />
          <div className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold">Service alerts</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {alertSummary}
                </p>
              </div>
              <SubscribeLink
                getPath={getPath}
                mate={mate}
                terminal={displayTerminal}
              />
            </div>
            <NotificationPermissionWarning
              className="mt-4"
              hasAlerts={hasConfiguredAlerts}
            />
            {/* preserve saved alerts while their current source state resolves */}
            {activeBulletins.length > 0 ? (
              <ul className="mt-2">{activeBulletins.map(renderBulletin)}</ul>
            ) : null}
            {/* pending empty data remains unknown rather than an all-clear */}
            {activeBulletins.length === 0 &&
            !hasCurrentBulletinStatus &&
            !alertsUnavailable ? (
              <AlertsResultsSkeleton />
            ) : null}
            {/* source failures remain visibly unknown and retryable */}
            {activeBulletins.length === 0 && alertsUnavailable ? (
              <section className="border-b border-black/10 py-5 dark:border-white/10">
                <BellAlertIcon
                  aria-hidden="true"
                  className="mb-2 h-6 w-6 text-blue-dark dark:text-[#6fb8c8]"
                />
                <h3 className="font-bold">Service alerts unavailable</h3>
                <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                  Ferry FYI could not confirm the current WSF alert status.
                </p>
                <button
                  className="button button-primary button-small mt-3"
                  disabled={isRefreshing}
                  onClick={() => {
                    // retry the same departure-terminal alert feed
                    refresh().catch(console.error);
                  }}
                  type="button"
                >
                  {isRefreshing ? "Checking…" : "Try again"}
                </button>
              </section>
            ) : null}
            {/* only an explicit empty result supports an all-clear */}
            {activeBulletins.length === 0 && hasCurrentBulletinStatus ? (
              <section className="py-6 text-center">
                <BellAlertIcon
                  aria-hidden="true"
                  className="mx-auto mb-2 h-7 w-7 text-blue-dark dark:text-[#6fb8c8]"
                />
                <h3 className="text-lg font-bold text-gray-darkest dark:text-white">
                  All clear
                </h3>
                <p className="mt-1 text-sm text-gray-dark dark:text-[#b8d5de]">
                  WSF has no active medium or high priority alerts for this
                  route.
                </p>
              </section>
            ) : null}
          </div>
        </section>
      </main>
      {/* float source freshness above route navigation without reserving scroll space */}
      {sourceUpdatedAt && hasUsableBulletins ? (
        <div
          className="pointer-events-none fixed inset-x-0 z-10 flex justify-center"
          data-live-freshness="bulletins"
          data-source-updated-at={sourceUpdatedAt}
          style={{
            bottom:
              "calc(var(--route-footer-height) + var(--safe-area-inset-bottom) + 0.25rem)",
          }}
        >
          <FreshnessPill
            className="pointer-events-auto whitespace-nowrap"
            isRefreshing={isRefreshing}
            onClick={() => {
              // refresh only after an explicit freshness action
              refresh().catch(console.error);
            }}
            sourceUpdatedAt={sourceUpdatedAt}
          />
        </div>
      ) : null}
      {refreshError ? (
        <Toast footerDocked error>
          {hasUsableBulletins
            ? "Could not refresh alerts. Showing saved data."
            : "Could not refresh alerts. Current WSF alert status is unavailable."}
        </Toast>
      ) : null}
    </>
  );
};

// keep the generic module fallback honest when route identity is unavailable
const BulletinsLoadingSkeleton = (): ReactElement => (
  <main className="flex-grow overflow-y-scroll scrolling-touch bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
    <AlertsLoadingContent />
  </main>
);
