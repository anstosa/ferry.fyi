import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement, ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { type Bulletin, Level } from "shared/contracts/bulletins";
import type { Route } from "shared/contracts/routes";
import type { Terminal } from "shared/contracts/terminals";
import { isRuleForRoute } from "shared/lib/alertSubscriptions";

import { ExternalPillLink } from "~/components/ExternalPillLink";
import { FreshnessPill } from "~/components/FreshnessPill";
import { HeaderDropdown } from "~/components/HeaderDropdown";
import { NotificationPermissionWarning } from "~/components/NotificationPermissionWarning";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";
import { Toast } from "~/components/Toast";
import { getBulletinTime, getRouteBulletins } from "~/lib/bulletins";
import {
  getBulletinFreshness,
  getSlug,
  refreshBulletins,
  useTerminals,
} from "~/lib/terminals";
import { useUser } from "~/lib/user";
import UnsubscribedIcon from "~/static/images/icons/regular/bell.svg";
import SubscribedIcon from "~/static/images/icons/solid/bell.svg";
import BellAlertIcon from "~/static/images/icons/solid/bell-exclamation.svg";
import WarningIcon from "~/static/images/icons/solid/exclamation-triangle.svg";
import InfoIcon from "~/static/images/icons/solid/info-circle.svg";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";

import { Header } from "./Header";
import type { GetPath } from "./Route";

interface RouteOption {
  mate: Terminal;
  route: Route;
  terminal: Terminal;
}

interface BulletinLevelStyles {
  accent: string;
  badge: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
}

// bulletin severity style
const getBulletinLevelStyles = (level: Level): BulletinLevelStyles => {
  // high severity guard
  if (level === Level.HIGH) {
    return {
      accent: "bg-stale-light dark:bg-stale-dark",
      badge:
        "border-stale-light bg-stale-light text-white dark:border-stale-dark dark:bg-stale-dark dark:text-[#ffb3b0]",
      Icon: WarningIcon,
      label: "High impact",
    };
  }
  return {
    accent: "bg-blue-dark dark:bg-[#6fb8c8]",
    badge:
      "border-blue-dark bg-night-normal-light text-blue-dark dark:border-[#6fb8c8] dark:bg-blue-dark dark:text-[#b8e4f0]",
    Icon: InfoIcon,
    label: "Advisory",
  };
};

// collect route choices
const getRouteOptions = (terminals: Terminal[]): RouteOption[] => {
  const terminalsById = Object.fromEntries(
    terminals.map((terminal) => {
      return [terminal.id, terminal];
    })
  );
  const routesById = new Map<string, RouteOption>();
  // terminal route loop
  terminals.forEach((terminal) => {
    // route loop
    Object.values(terminal.routes ?? {}).forEach((route) => {
      // duplicate route guard
      if (routesById.has(route.id)) {
        return;
      }
      const routeTerminals = route.terminalIds
        .map((terminalId) => {
          return terminalsById[terminalId];
        })
        .filter((terminal): terminal is Terminal => Boolean(terminal));
      // incomplete route guard
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
  return Array.from(routesById.values()).sort((left, right) => {
    // alphabetical route order
    return left.route.description.localeCompare(right.route.description);
  });
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
  const hasAlertRules = alertRules?.some((rule) => {
    return isRuleForRoute(rule, terminalIds);
  });
  const isSubscribed = hasAlertRules;
  const label = isSubscribed ? "Edit alerts" : "Set up alerts";

  return (
    <Link
      className={clsx("button", {
        "button-invert": isSubscribed,
        "button-outline": !isSubscribed,
      })}
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
  setRoute: (target: string, mate?: string) => void;
  terminal: Terminal | null;
  time: DateTime;
}

export const Bulletins = ({
  getPath,
  mate,
  setRoute,
  terminal,
  time,
}: Props): ReactElement => {
  const { terminals } = useTerminals();
  const [isRouteOpen, setRouteOpen] = useState<boolean>(false);
  const [sourceUpdatedAt, setSourceUpdatedAt] = useState<number | null>(null);
  const [refreshedTerminal, setRefreshedTerminal] = useState<Terminal | null>(
    null
  );
  const [isRefreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const routeOptions = getRouteOptions(terminals);
  const [{ alertRules }] = useUser();

  useEffect(() => setRefreshedTerminal(null), [terminal?.id]);
  useEffect(() => {
    getBulletinFreshness()
      .then(({ sourceUpdatedAt }) => setSourceUpdatedAt(sourceUpdatedAt))
      .catch(console.error);
  }, [terminal?.id]);

  // defensive isolated-render loading guard
  if (!terminal) {
    return <BulletinsLoadingSkeleton />;
  }
  const displayTerminal = refreshedTerminal ?? terminal;

  const selectedRoute = mate
    ? Object.values(displayTerminal.routes ?? {}).find((route) => {
        // selected route match
        return (
          route.terminalIds.includes(displayTerminal.id) &&
          route.terminalIds.includes(mate.id)
        );
      })
    : undefined;
  const routeName =
    selectedRoute?.description ??
    (mate ? `${displayTerminal.name} / ${mate.name}` : displayTerminal.name);
  const routeShortName = selectedRoute?.abbreviation ?? routeName;
  const activeBulletins = getRouteBulletins(displayTerminal, mate);
  const hasConfiguredAlerts = (alertRules ?? []).some((rule) =>
    isRuleForRoute(
      rule,
      mate ? [displayTerminal.id, mate.id] : [displayTerminal.id]
    )
  );

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    setRefreshError(false);
    try {
      const result = await refreshBulletins(displayTerminal.id);
      setSourceUpdatedAt(result.sourceUpdatedAt);
      setRefreshedTerminal(result.terminal);
    } catch (error) {
      setRefreshError(true);
      throw error;
    } finally {
      setRefreshing(false);
    }
  };

  const renderBulletin = (bulletin: Bulletin): ReactNode => {
    const { bodyText, date, level, routePrefix, title, url } = bulletin;
    const { accent, badge, Icon, label } = getBulletinLevelStyles(level);
    return (
      <li
        className={clsx(
          "relative overflow-hidden rounded-2xl border bg-white shadow-sm",
          "border-[rgba(0,0,0,0.08)]",
          "dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]"
        )}
        key={`${date}:${title}`}
      >
        <span className={clsx("absolute inset-y-0 left-0 w-1.5", accent)} />
        <article className="p-4 pl-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span
              className={clsx(
                "inline-flex items-center rounded-full border px-2.5 py-1",
                "text-2xs font-bold uppercase tracking-wide",
                badge
              )}
            >
              <Icon className="mr-1.5 h-3 w-3" />
              {label}
            </span>
            <span className="rounded-full bg-day-normal-light px-2.5 py-1 text-2xs font-semibold uppercase tracking-wide text-[#7a5400] dark:bg-[#261f00] dark:text-[#f2b705]">
              {getBulletinTime(bulletin, time)}
            </span>
            {routePrefix !== "All" && (
              <span className="rounded-full bg-night-normal-light px-2.5 py-1 text-2xs font-semibold uppercase tracking-wide text-blue-dark dark:bg-blue-dark dark:text-[#b8e4f0]">
                {routePrefix}
              </span>
            )}
          </div>
          <div className="flex items-start">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold leading-snug text-gray-darkest dark:text-white">
                {title}
              </h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-dark dark:text-[#e0f0f4]">
                {bodyText}
              </p>
              {url && (
                <ExternalPillLink className="mt-3" href={url}>
                  View WSF alert
                </ExternalPillLink>
              )}
            </div>
          </div>
        </article>
      </li>
    );
  };

  return (
    <>
      <Header
        share={{
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
            getKey={(option) => {
              // route option key
              return option.route.id;
            }}
            getLabel={(option) => {
              // route option label
              return option.route.description;
            }}
            getShortLabel={(option) => {
              // route option short label
              return option.route.abbreviation;
            }}
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
      <main className="flex-grow overflow-y-scroll scrolling-touch bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
        <section className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
          <div
            className={clsx(
              "mb-4 overflow-hidden rounded-2xl border shadow-sm",
              "border-[rgba(0,0,0,0.08)]",
              "bg-[linear-gradient(135deg,#016f52_0%,#004d61_100%)]",
              "text-white"
            )}
          >
            <div className="p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15">
                    <BellAlertIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-2xs font-bold uppercase tracking-[0.16em] text-[#b8e4f0]">
                      Route alerts
                    </p>
                    <h1 className="mt-1 text-2xl font-bold leading-tight">
                      {routeName}
                    </h1>
                    <p className="mt-2 text-sm leading-relaxed text-white/85">
                      {activeBulletins.length > 0
                        ? `${activeBulletins.length} active ${
                            activeBulletins.length === 1 ? "alert" : "alerts"
                          } from WSF`
                        : "No active service alerts right now"}
                    </p>
                  </div>
                </div>
                <div className="w-full sm:w-auto sm:shrink-0">
                  <SubscribeLink
                    getPath={getPath}
                    terminal={displayTerminal}
                    mate={mate}
                  />
                </div>
              </div>
            </div>
          </div>
          <NotificationPermissionWarning
            className="mb-4"
            hasAlerts={hasConfiguredAlerts}
          />
          {sourceUpdatedAt ? (
            <div className="mb-2 flex justify-center">
              <FreshnessPill
                isRefreshing={isRefreshing}
                onClick={() => {
                  refresh().catch(console.error);
                }}
                sourceUpdatedAt={sourceUpdatedAt}
              />
            </div>
          ) : null}
          {activeBulletins.length > 0 ? (
            <ul className="flex flex-col gap-4">
              {activeBulletins.map(renderBulletin)}
            </ul>
          ) : (
            <div
              className={clsx(
                "rounded-2xl border bg-white p-6 text-center shadow-sm",
                "border-[rgba(0,0,0,0.08)]",
                "dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]"
              )}
            >
              <BellAlertIcon className="mx-auto mb-3 h-8 w-8 text-blue-dark dark:text-[#6fb8c8]" />
              <h2 className="text-lg font-bold text-gray-darkest dark:text-white">
                All clear
              </h2>
              <p className="mt-2 text-sm text-gray-dark dark:text-[#b8d5de]">
                WSF has no active medium or high priority alerts for this route.
              </p>
            </div>
          )}
        </section>
      </main>
      {refreshError ? (
        <Toast footerDocked error>
          Could not refresh alerts. Showing saved data.
        </Toast>
      ) : null}
    </>
  );
};

const BulletinsLoadingSkeleton = (): ReactElement => {
  return (
    <main className="flex-grow overflow-y-scroll scrolling-touch bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
      <SkeletonGroup
        className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5 sm:px-6"
        label="Loading alerts"
      >
        <div className="space-y-3 rounded-2xl bg-[#016f52] p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <Skeleton className="h-11 w-11 shrink-0" variant="circle" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24" variant="text" />
              <Skeleton className="h-8 w-2/3" variant="text" />
              <Skeleton className="h-4 w-1/2" variant="text" />
            </div>
          </div>
        </div>
        {[0, 1].map((index) => (
          <div
            className="space-y-3 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5 dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]"
            key={index}
          >
            <Skeleton className="h-5 w-28" variant="text" />
            <Skeleton className="h-6 w-3/4" variant="text" />
            <Skeleton className="h-4 w-full" variant="text" />
            <Skeleton className="h-4 w-5/6" variant="text" />
          </div>
        ))}
      </SkeletonGroup>
    </main>
  );
};
