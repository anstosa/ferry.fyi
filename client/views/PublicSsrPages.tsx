import { DateTime } from "luxon";
import React, { type ReactElement } from "react";
import { Link } from "react-router-dom";
import { Level } from "shared/contracts/bulletins";
import type {
  PublicSsrSnapshot,
  PublicSsrSourceKey,
} from "shared/contracts/ssr";
import { isSuppressedBulletin } from "shared/lib/bulletins";
import { getRecommendationServiceDate } from "shared/lib/sailingRecommendationRevision";
import { getSeoMetadata, type SeoMetadata } from "shared/lib/seo";
import { getStaticPublicSsrTerminalSlug } from "shared/lib/ssrRouteMatch";

import { AdCreativeCard } from "~/components/AdCreativeCard";
import { AlertsOverview } from "~/components/AlertsOverview";
import { CameraImageFooter } from "~/components/CameraImageFooter";
import { CameraOverview } from "~/components/CameraOverview";
import { FareCatalogDisclosure } from "~/components/FareCatalogDisclosure";
import { FareRatesOverview } from "~/components/FareRatesOverview";
import { HomeHero } from "~/components/HomeHero";
import { HomeTerminalDirectory } from "~/components/HomeTerminalDirectory";
import { PublicScheduleDetails } from "~/components/PublicScheduleDetails";
import { RoutePageIntro } from "~/components/RoutePageIntro";
import { RoutePlanningLinks } from "~/components/RoutePlanningLinks";
import { ScheduleOverview } from "~/components/ScheduleOverview";
import { SeoHelmet } from "~/components/SeoHelmet";
import { SsrPage } from "~/components/SsrPage";
import { TerminalOverview } from "~/components/TerminalOverview";
import { useAppRenderContext } from "~/lib/renderContext";
import {
  getPublicSsrSourceOutcome,
  usePublicSsrSnapshot,
  usePublicSsrSource,
  usePublicSsrSourceOutcome,
} from "~/lib/ssrSeed";
import AlertsIcon from "~/static/images/icons/solid/bell-exclamation.svg";

// format displayed pacific timestamps
function formatSnapshotTime(value: string): string {
  return DateTime.fromISO(value, { zone: "America/Los_Angeles" }).toFormat(
    "MMM d, h:mm a ZZZZ"
  );
}

// show the anonymous creative
const PublicAd = ({
  className = "",
}: {
  className?: string;
}): ReactElement | null => {
  const ad = usePublicSsrSource("ad");
  return ad?.creative ? (
    <div className={className} data-ad-slot={ad.creative.placementKey}>
      <AdCreativeCard creative={ad.creative} />
    </div>
  ) : null;
};

// link public sibling views without browser-only navigation
const PublicRouteNavigation = (): ReactElement | null => {
  const route = usePublicSsrSource("route");
  // omit navigation without a selected public direction
  if (!route) {
    return null;
  }
  const terminalSlug = getStaticPublicSsrTerminalSlug(route.terminal.id);
  const mateSlug = getStaticPublicSsrTerminalSlug(route.mate.id);
  // unknown terminal identities have no canonical links
  if (!terminalSlug || !mateSlug) {
    return null;
  }
  const base = `/${terminalSlug}${route.terminal.mates.length === 1 ? "" : `/${mateSlug}`}`;
  return (
    <nav aria-label="Route navigation" className="my-4 flex flex-wrap gap-3">
      {[
        ["", "Schedule"],
        ["/cameras", "Cameras"],
        ["/terminal", "Terminal"],
        ["/map", "Map"],
        ["/fare", "Fares"],
        ["/alerts", "Alerts and bulletins"],
        ["/subscribe", "Alert subscriptions"],
      ].map(([suffix, label]) => (
        <Link
          className="underline"
          key={suffix}
          to={
            suffix === "/terminal"
              ? `/${terminalSlug}/terminal`
              : `${base}${suffix}`
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
};

// retain public alert text and source time without redundant landing links
const PublicBulletin = ({
  bulletin,
  compact = false,
}: {
  bulletin: import("shared/contracts/bulletins").Bulletin;
  compact?: boolean;
}): ReactElement => {
  const severity = bulletin.level === Level.HIGH ? "High impact" : "Advisory";
  return (
    <section>
      <h2 className={compact ? "text-lg font-bold leading-snug" : undefined}>
        {bulletin.title}
      </h2>
      <p
        className={
          compact
            ? "mt-2 whitespace-pre-line break-words text-sm leading-relaxed"
            : "whitespace-pre-line"
        }
      >
        {bulletin.bodyText}
      </p>
      <p
        className={
          compact ? "mt-2 text-xs text-gray-600 dark:text-gray-300" : undefined
        }
      >
        {/* retain severity labels in the compact initial alert view */}
        {compact ? severity : bulletin.level} ·{" "}
        <time
          dateTime={
            DateTime.fromSeconds(bulletin.date, { zone: "utc" }).toISO() ??
            undefined
          }
        >
          {formatSnapshotTime(
            DateTime.fromSeconds(bulletin.date, { zone: "utc" }).toISO() ?? ""
          )}
        </time>
        {compact && bulletin.routePrefix !== "All"
          ? ` · ${bulletin.routePrefix}`
          : null}
      </p>
    </section>
  );
};

const UNAVAILABLE_REASON_LABELS = {
  "not-published": "not published",
  "not-supported": "not supported",
  "source-unavailable": "source unavailable",
} as const;

type SnapshotSourceDescriptor = {
  key: PublicSsrSourceKey;
  label: string;
};

// show page and source timestamps
const SnapshotFreshness = ({
  primarySource,
  sources,
}: {
  primarySource: PublicSsrSourceKey;
  sources: readonly SnapshotSourceDescriptor[];
}): ReactElement | null => {
  const snapshot = usePublicSsrSnapshot();
  if (!snapshot) {
    return null;
  }
  return (
    <div
      aria-label="Page and source freshness"
      className="mt-2 text-xs opacity-80"
      data-public-ssr-freshness={primarySource}
    >
      {sources.map(({ key, label }) => {
        const source = getPublicSsrSourceOutcome(snapshot, key);
        if (!source) {
          return null;
        }
        const sourceTime = source.sourceUpdatedAt ?? source.observedAt;
        let sourceLead = `${label} checked `;
        if (source.outcome === "authoritatively-unavailable") {
          sourceLead = `${label}: ${UNAVAILABLE_REASON_LABELS[source.reason]}; checked `;
        } else if (source.outcome === "transiently-unavailable") {
          sourceLead = `${label}: ${source.reason}; checked `;
        } else if (source.outcome === "empty") {
          sourceLead = `${label}: no current public results; checked `;
        } else if (source.outcome === "stale-usable") {
          sourceLead = `${label}: stale public data from `;
        } else if (source.sourceUpdatedAt) {
          sourceLead = `${label} updated `;
        }
        return (
          <p data-public-ssr-source={key} key={key}>
            {sourceLead}
            <time dateTime={sourceTime}>{formatSnapshotTime(sourceTime)}</time>
          </p>
        );
      })}
      <p>
        Page generated{" "}
        <time dateTime={snapshot.renderedAt}>
          {formatSnapshotTime(snapshot.renderedAt)}
        </time>
      </p>
    </div>
  );
};

// show public service notices
const PublicNotices = ({
  includeBulletins = false,
}: {
  includeBulletins?: boolean;
}): ReactElement | null => {
  const notices = usePublicSsrSource("notices");
  // apply current suppression rules to saved snapshot notices
  const bulletinsSource = (usePublicSsrSource("bulletins") ?? []).filter(
    (bulletin) => !isSuppressedBulletin(bulletin)
  );
  const bulletins = includeBulletins ? bulletinsSource : [];
  if (
    (!notices ||
      (!notices.maintenance.enabled && notices.announcements.length === 0)) &&
    bulletins.length === 0
  ) {
    return null;
  }
  return (
    <aside aria-label="Service notices" className="my-3">
      {notices?.maintenance.enabled ? (
        <p>
          <strong>Service notice:</strong> {notices.maintenance.message}
        </p>
      ) : null}
      {notices?.announcements.map((announcement) => (
        <section key={announcement.id}>
          <h2>{announcement.title}</h2>
          <p>{announcement.body}</p>
        </section>
      ))}
      {bulletins.map((bulletin) => (
        <PublicBulletin
          bulletin={bulletin}
          key={`${bulletin.date}:${bulletin.title}`}
        />
      ))}
    </aside>
  );
};

// preserve canonical snapshot metadata
export const resolveSnapshotSeo = (
  metadata: PublicSsrSnapshot["metadata"] | undefined,
  fallback: SeoMetadata,
  pathname = metadata?.canonicalPath
): SeoMetadata =>
  metadata && metadata.canonicalPath === pathname
    ? {
        ...metadata,
        schema: {
          "@type": "WebPage",
          description: metadata.description,
          name: metadata.title,
          url: metadata.canonicalPath,
        },
      }
    : fallback;

// render canonical public metadata
export const SnapshotSeoHelmet = ({
  fallback,
  title,
}: {
  fallback: SeoMetadata;
  title?: string;
}): ReactElement => {
  const snapshot = usePublicSsrSnapshot();
  const { seoPathname } = useAppRenderContext();
  const seo = resolveSnapshotSeo(snapshot?.metadata, fallback, seoPathname);
  return <SeoHelmet seo={seo} title={title} />;
};

// render public leaderboards
export const PublicLeaderboards = (): ReactElement => {
  const snapshot = usePublicSsrSnapshot();
  const features = usePublicSsrSource("features");
  const index = usePublicSsrSource("leaderboardIndex");
  const board = usePublicSsrSource("leaderboard");
  const boardOutcome = usePublicSsrSourceOutcome("leaderboard");
  const indexOutcome = usePublicSsrSourceOutcome("leaderboardIndex");
  const leaderboardSource =
    snapshot?.routeId === "leaderboards" ? "leaderboardIndex" : "leaderboard";
  const leaderboardOutcome =
    leaderboardSource === "leaderboard" ? boardOutcome : indexOutcome;
  return (
    <SsrPage>
      <SnapshotSeoHelmet fallback={getSeoMetadata("/leaderboards")} />
      <h1>Leaderboards</h1>
      <SnapshotFreshness
        primarySource={leaderboardSource}
        sources={[
          { key: "features", label: "Leaderboard availability" },
          {
            key: leaderboardSource,
            label: "Leaderboard data",
          },
          { key: "notices", label: "Service notices" },
        ]}
      />
      <PublicNotices />
      <PublicRouteNavigation />
      {features?.leaderboardsEnabled === false ? (
        <p>Public leaderboards are currently disabled.</p>
      ) : null}
      <p>
        Period:{" "}
        {(board?.period ?? index?.defaultPeriod) === "all"
          ? "All time"
          : (board?.period ?? index?.defaultPeriod ?? "Unavailable")}
        .
      </p>
      {board ? (
        <h2>
          {board.entity.label} ({board.entity.kind})
        </h2>
      ) : null}
      {board && !board.ranks.length ? <p>No public ranks yet.</p> : null}
      {index && !index.entities.length ? (
        <p>No public leaderboard entities are available.</p>
      ) : null}
      {board?.ranks.length ? (
        <ol>
          {board.ranks.map((rank) => (
            <li key={`${rank.rank}:${rank.label}`}>
              {rank.rank}. {rank.label} — {rank.score}{" "}
              {rank.score === 1 ? "check-in" : "check-ins"}
              {rank.supporterBadge ? " · Supporter badge" : ""}
            </li>
          ))}
        </ol>
      ) : null}
      <ul>
        {(index?.entities ?? []).map((entity) => (
          <li key={entity.id}>
            <Link to={`/leaderboards/${entity.kind}s/${entity.id}`}>
              {entity.label}
            </Link>
          </li>
        ))}
      </ul>
      {leaderboardOutcome?.outcome === "authoritatively-unavailable" ? (
        <p>Leaderboard data is not available from its authoritative source.</p>
      ) : null}
    </SsrPage>
  );
};

/** Public first-render copy for the account-backed alert editor. */
// render public alertguidance
export const PublicAlertGuidance = (): ReactElement => {
  const guidance = usePublicSsrSource("alertGuidance");
  const guidanceOutcome = usePublicSsrSourceOutcome("alertGuidance");
  const route = usePublicSsrSource("route");
  let guidanceBody =
    guidance?.body ?? "Sign in after the app is ready to manage alerts.";
  if (!guidance && guidanceOutcome?.outcome === "authoritatively-unavailable") {
    guidanceBody =
      "Public alert guidance is not available from its authoritative source.";
  }
  return (
    <SsrPage>
      <SnapshotSeoHelmet fallback={getSeoMetadata("/")} />
      <h1>
        {route
          ? `Alerts for ${route.terminal.name} to ${route.mate.name}`
          : "Ferry alerts"}
      </h1>
      <SnapshotFreshness
        primarySource="alertGuidance"
        sources={[
          { key: "route", label: "Route details" },
          { key: "alertGuidance", label: "Alert guidance" },
          { key: "notices", label: "Service notices" },
        ]}
      />
      <PublicNotices />
      <PublicRouteNavigation />
      <p>{guidanceBody}</p>
      <p className="mt-3 text-sm">
        Alert subscriptions are personal and load only after sign-in. Choose a
        route and sailing time to receive the alerts you request; delivery
        depends on service data and your device notification permissions. Review
        and remove subscriptions from your account. Sign in to manage personal
        alert rules.
      </p>
    </SsrPage>
  );
};

/** Anonymous map fallback that keeps live vessel context visible without Mapbox. */
// render public routemap
export const PublicRouteMap = (): ReactElement => {
  const route = usePublicSsrSource("route");
  const vessels = usePublicSsrSource("vessels");
  const vesselsOutcome = usePublicSsrSourceOutcome("vessels");
  let vesselOutcomeNotice: ReactElement | null = null;
  if (vesselsOutcome?.outcome === "empty") {
    vesselOutcomeNotice = <p>No active vessel positions were reported.</p>;
  } else if (vesselsOutcome?.outcome === "authoritatively-unavailable") {
    vesselOutcomeNotice = (
      <p>Vessel positions are not available from their authoritative source.</p>
    );
  }
  return (
    <SsrPage>
      <SnapshotSeoHelmet fallback={getSeoMetadata("/")} />
      <h1>Route map</h1>
      <SnapshotFreshness
        primarySource="vessels"
        sources={[
          { key: "route", label: "Route details" },
          { key: "vessels", label: "Vessel positions" },
          { key: "notices", label: "Service notices" },
        ]}
      />
      <PublicNotices />
      <PublicRouteNavigation />
      <p>
        {route
          ? `Vessel positions reported for ${route.terminal.name} and ${route.mate.name}.`
          : "Vessel positions are temporarily unavailable."}
      </p>
      {route ? (
        <p>
          Terminal coordinates: {route.terminal.name}{" "}
          {route.terminal.location.latitude},{" "}
          {route.terminal.location.longitude}; {route.mate.name}{" "}
          {route.mate.location.latitude}, {route.mate.location.longitude}.{" "}
          {route.terminal.vesselWatchUrl ? (
            <a href={route.terminal.vesselWatchUrl}>WSF vessel watch</a>
          ) : null}
        </p>
      ) : null}
      <ul>
        {(vessels ?? []).map((vessel) => (
          <li key={vessel.id}>
            {vessel.name}
            {vessel.location
              ? ` — ${vessel.location.latitude.toFixed(3)}, ${vessel.location.longitude.toFixed(3)}`
              : " — position unavailable"}
            <p>
              In service: {vessel.inService ? "yes" : "no"}. Maintenance:{" "}
              {vessel.inMaintenance ? "yes" : "no"}.
            </p>
            {typeof vessel.isAtDock === "boolean" ? (
              <p>At dock: {vessel.isAtDock ? "yes" : "no"}.</p>
            ) : null}
            {typeof vessel.heading === "number" ? (
              <p>Heading: {vessel.heading}°.</p>
            ) : null}
            {typeof vessel.speed === "number" ? (
              <p>Speed: {vessel.speed} knots.</p>
            ) : null}
          </li>
        ))}
      </ul>
      {vesselOutcomeNotice}
    </SsrPage>
  );
};

// render common official rates before the interactive custom calculator
export const PublicFares = (): ReactElement => {
  const fares = usePublicSsrSource("fares");
  const route = usePublicSsrSource("route");
  const fareOutcome = usePublicSsrSourceOutcome("fares");
  return (
    <SsrPage routePage>
      <SnapshotSeoHelmet fallback={getSeoMetadata("/")} />
      {fares && route ? (
        <FareRatesOverview
          response={fares}
          departingName={route.terminal.name}
          arrivingName={route.mate.name}
          mate={route.mate}
          terminal={route.terminal}
        />
      ) : (
        <>
          <RoutePageIntro title="Ferry fares" />
          {route ? (
            <RoutePlanningLinks
              currentView="fare"
              mate={route.mate}
              terminal={route.terminal}
            />
          ) : null}
        </>
      )}
      <PublicAd className="my-4" />
      <PublicNotices />
      {fareOutcome?.outcome === "stale-usable" ? (
        <p>The displayed fare catalog is stale; verify prices with WSDOT.</p>
      ) : null}
      <div
        id="custom-fare-calculator"
        className="my-4 min-h-[100dvh] scroll-mt-4 space-y-4"
      >
        <section aria-label="Fare estimator">
          <h2>Calculate a custom fare</h2>
          <p>
            Choose passengers, vehicle size and eligible discounts after the
            interactive calculator loads. Official WSDOT fares are used; Ferry
            FYI does not determine eligibility. The rates above are standard
            choices, not a personalized estimate.
          </p>
          {route ? (
            <p>
              {route.terminal.name} to {route.mate.name}.
            </p>
          ) : null}
          {fares ? (
            <p>
              Travel date:{" "}
              {
                (fares.state === "current" ? fares.catalog : fares.noFare)
                  .request.tripDate
              }
              .
            </p>
          ) : null}
        </section>
        {fares ? (
          <FareCatalogDisclosure
            response={fares}
            departingName={route?.terminal.name}
            arrivingName={route?.mate.name}
          />
        ) : (
          <p>Official fare data is not available for this route and date.</p>
        )}
      </div>
    </SsrPage>
  );
};

/** server-safe schedule presentation from the complete anonymous schedule source. */
// render public schedule
export const PublicSchedule = (): ReactElement => {
  const { clock } = useAppRenderContext();
  const snapshot = usePublicSsrSnapshot();
  const route = usePublicSsrSource("route");
  const schedule = usePublicSsrSource("schedule")?.schedule;
  const nextSchedule = usePublicSsrSource("nextSchedule")?.schedule;
  const wsf = usePublicSsrSource("wsf");
  const time = DateTime.fromMillis(clock(), { zone: "America/Los_Angeles" });
  const selectedDate =
    schedule?.date ??
    snapshot?.normalizedUrl.query.date ??
    getRecommendationServiceDate(time.toSeconds());
  let wsfNotice: ReactElement | null = null;
  if (wsf?.offline) {
    wsfNotice = (
      <p>Washington State Ferries live data is temporarily offline.</p>
    );
  } else if (wsf?.warming) {
    wsfNotice = <p>Washington State Ferries live data is still warming up.</p>;
  } else if (wsf?.coreReady === false) {
    wsfNotice = <p>Washington State Ferries core data is not ready.</p>;
  }
  return (
    <SsrPage routePage>
      <SnapshotSeoHelmet fallback={getSeoMetadata("/")} />
      {/* keep the same route answer visible before browser hydration */}
      {route ? (
        <ScheduleOverview
          inset={false}
          mate={route.mate}
          schedule={schedule ?? null}
          selectedDate={selectedDate}
          terminal={route.terminal}
          time={time}
        />
      ) : (
        <RoutePageIntro title="Washington State Ferries schedule" />
      )}
      <PublicNotices includeBulletins />
      {wsfNotice}
      {route ? (
        <ul>
          {Object.values(route.terminal.routes)
            .filter((item) => item.terminalIds.includes(route.mate.id))
            .map((item) => (
              <li key={item.id}>
                {item.description} · crossing time: {item.crossingTime} minutes.
              </li>
            ))}
        </ul>
      ) : null}
      <PublicAd className="my-4" />
      {schedule ? (
        <PublicScheduleDetails
          id="departures"
          location={route?.terminal.location}
          schedule={schedule}
          showDisclaimer={false}
          time={time}
          title={null}
        />
      ) : (
        <p>Schedule data is temporarily unavailable.</p>
      )}
      {nextSchedule ? (
        <PublicScheduleDetails
          schedule={nextSchedule}
          showDisclaimer={false}
          title="Next service date"
        />
      ) : (
        <p>Next service date schedule is temporarily unavailable.</p>
      )}
      <SnapshotFreshness
        primarySource="schedule"
        sources={[
          { key: "route", label: "Route details" },
          { key: "schedule", label: "Schedule data" },
          { key: "nextSchedule", label: "Next-day schedule" },
          { key: "wsf", label: "WSF status" },
          { key: "bulletins", label: "Service alerts" },
          { key: "notices", label: "Service notices" },
        ]}
      />
    </SsrPage>
  );
};

// render public cameras
export const PublicCameras = (): ReactElement => {
  const snapshot = usePublicSsrSnapshot();
  const route = usePublicSsrSource("route");
  const frames = usePublicSsrSource("cameraFrames");
  const framesOutcome = usePublicSsrSourceOutcome("cameraFrames");
  const cameras = route?.terminal.cameras ?? [];
  const renderedAt = snapshot ? Date.parse(snapshot.renderedAt) / 1000 : NaN;
  return (
    <SsrPage routePage>
      <SnapshotSeoHelmet fallback={getSeoMetadata("/")} />
      {route ? (
        <CameraOverview
          inset={false}
          mate={route.mate}
          terminal={route.terminal}
        />
      ) : (
        <RoutePageIntro title="Ferry terminal cameras" />
      )}
      <PublicNotices />
      <PublicAd className="my-4" />
      {cameras.length ? (
        <ul className="space-y-8 py-4">
          {cameras.map((camera) => {
            const frame = frames?.frames[camera.id];
            let frameStatus = "Camera image status was not reported.";
            // unavailable source status must not become a fresh-image claim
            if (frame?.status === "unavailable") {
              frameStatus = "Camera image unavailable.";
            } else if (frame?.isStale) {
              frameStatus = "Camera image may be stale.";
            } else if (frame) {
              frameStatus = "Camera image available.";
            } else if (
              framesOutcome?.outcome === "authoritatively-unavailable"
            ) {
              frameStatus =
                "Camera image status is not available from its authoritative source.";
            } else if (framesOutcome?.outcome === "empty") {
              frameStatus = "No current camera image status was reported.";
            }
            return (
              <li key={camera.id}>
                <h2 className="text-lg font-bold">{camera.title}</h2>
                <div className="relative w-full max-w-[480px] overflow-hidden">
                  <img
                    alt={`Traffic camera at ${route?.terminal.name ?? "the"} ferry terminal: ${camera.title}`}
                    className="block w-full max-w-[480px]"
                    src={frame?.imageUrl ?? camera.image.url}
                  />
                  <CameraImageFooter
                    frameStatus={frame}
                    now={renderedAt}
                    ownerName={camera.owner?.name}
                    passive
                  />
                </div>
                <p>
                  {frameStatus} Camera:{" "}
                  {camera.isActive ? "active" : "inactive"}.
                </p>
                {camera.owner ? (
                  <p>
                    Source: <a href={camera.owner.url}>{camera.owner.name}</a>
                  </p>
                ) : null}
                <p>
                  Location: {camera.location.latitude},{" "}
                  {camera.location.longitude}. Queue order from terminal:{" "}
                  {camera.orderFromTerminal}.
                </p>
                {typeof camera.carCapacity === "number" ? (
                  <p>Static holding capacity: {camera.carCapacity} cars.</p>
                ) : null}
                {typeof camera.carsToBoat === "number" ? (
                  <p>
                    Camera position: {camera.carsToBoat} car spaces from
                    boarding.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>Camera views are not available in Ferry FYI for this terminal.</p>
      )}
      <PublicRouteNavigation />
      <SnapshotFreshness
        primarySource="cameraFrames"
        sources={[
          { key: "route", label: "Route details" },
          { key: "cameraFrames", label: "Camera data" },
          { key: "notices", label: "Service notices" },
        ]}
      />
    </SsrPage>
  );
};

// share the compact route overview and retain snapshot source states
export const PublicBulletins = (): ReactElement => {
  // prevent old snapshots from publishing suppressed promotions
  const bulletins = (usePublicSsrSource("bulletins") ?? []).filter(
    (bulletin) => !isSuppressedBulletin(bulletin)
  );
  const route = usePublicSsrSource("route");
  const bulletinsOutcome = usePublicSsrSourceOutcome("bulletins");
  let bulletinContent: ReactElement;
  // usable reports remain visible even when their snapshot is stale
  if (bulletins.length) {
    bulletinContent = (
      <ul className="mt-2">
        {bulletins.map((bulletin) => (
          // match unboxed browser rows without hiding source dates or severity
          <li
            className="border-b border-black/10 py-4 last:border-b-0 dark:border-white/10"
            key={`${bulletin.date}:${bulletin.title}`}
          >
            <PublicBulletin bulletin={bulletin} compact />
          </li>
        ))}
      </ul>
    );
  } else if (bulletinsOutcome?.outcome === "authoritatively-unavailable") {
    bulletinContent = (
      <p className="mt-3">
        Service alerts are not available from their authoritative source.
      </p>
    );
  } else if (
    bulletinsOutcome?.outcome === "empty" ||
    bulletinsOutcome?.outcome === "value" ||
    bulletinsOutcome?.outcome === "stale-usable"
  ) {
    // describe the saved list without claiming a live all-clear
    bulletinContent = (
      <p className="mt-3">No active alerts are listed in this snapshot.</p>
    );
  } else {
    // missing source results remain unknown
    bulletinContent = (
      <p className="mt-3">Current WSF alert status is unavailable.</p>
    );
  }
  const terminalSlug = route
    ? getStaticPublicSsrTerminalSlug(route.terminal.id)
    : undefined;
  const mateSlug = route
    ? getStaticPublicSsrTerminalSlug(route.mate.id)
    : undefined;
  const subscribePath =
    terminalSlug && mateSlug
      ? `/${terminalSlug}${route?.terminal.mates.length === 1 ? "" : `/${mateSlug}`}/subscribe`
      : null;
  return (
    <SsrPage routePage>
      <SnapshotSeoHelmet fallback={getSeoMetadata("/")} />
      {route ? (
        <AlertsOverview
          inset={false}
          mate={route.mate}
          terminal={route.terminal}
        />
      ) : (
        <RoutePageIntro title="WSF service alerts" />
      )}
      <SnapshotFreshness
        primarySource="bulletins"
        sources={[
          { key: "route", label: "Route details" },
          { key: "bulletins", label: "Service alerts" },
          { key: "notices", label: "Service notices" },
        ]}
      />
      <PublicNotices />
      <section className="py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-lg font-bold">Service alerts</h2>
          {subscribePath ? (
            <Link
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-green-dark px-3 py-2 text-sm font-semibold text-white"
              to={subscribePath}
            >
              <AlertsIcon aria-hidden="true" className="h-4 w-4" />
              Set up alerts
            </Link>
          ) : null}
        </div>
        {bulletinContent}
      </section>
    </SsrPage>
  );
};

/** server-safe terminal answers from the anonymous route source */
export const PublicTerminalDetails = (): ReactElement => {
  const route = usePublicSsrSource("route");
  const terminal = route?.terminal;
  // apply current alert policy to cached terminal snapshots
  const bulletins = (terminal?.bulletins ?? []).filter(
    (bulletin) => !isSuppressedBulletin(bulletin)
  );
  return (
    <SsrPage routePage>
      <SnapshotSeoHelmet fallback={getSeoMetadata("/")} />
      {/* use the same practical answers before and after hydration */}
      {terminal ? (
        <TerminalOverview
          afterNavigation={<PublicAd />}
          mate={route.mate}
          terminal={terminal}
        />
      ) : (
        <RoutePageIntro title="Terminal details" />
      )}
      <SnapshotFreshness
        primarySource="route"
        sources={[
          { key: "route", label: "Terminal details" },
          { key: "notices", label: "Service notices" },
        ]}
      />
      <PublicNotices />
      {terminal ? (
        <>
          {/* retain complete route reference facts without crowding practical answers */}
          <details className="my-4">
            <summary className="cursor-pointer font-bold">
              Route crossing times &amp; vessel facilities
            </summary>
            <ul>
              {Object.values(terminal.routes).map((item) => (
                <li key={item.id}>
                  {item.description} · crossing time: {item.crossingTime}{" "}
                  minutes.
                  {typeof item.averageVehicleCapacity === "number" ? (
                    <p>
                      Average vehicle capacity: {item.averageVehicleCapacity}.
                    </p>
                  ) : null}
                  {typeof item.normalVehicleCapacity === "number" ? (
                    <p>
                      Normal vehicle capacity: {item.normalVehicleCapacity}.
                    </p>
                  ) : null}
                  {typeof item.normalVehicleMaxCapacity === "number" ? (
                    <p>
                      Maximum normal vehicle capacity:{" "}
                      {item.normalVehicleMaxCapacity}.
                    </p>
                  ) : null}
                  {item.galleyHours?.map((rule, index) => (
                    <p key={index}>
                      Galley, vessel position {rule.vesselPosition}:{" "}
                      {rule.startTime}–{rule.endTime}, weekdays{" "}
                      {rule.days
                        .map(
                          (day) =>
                            [
                              "",
                              "Monday",
                              "Tuesday",
                              "Wednesday",
                              "Thursday",
                              "Friday",
                              "Saturday",
                              "Sunday",
                            ][day]
                        )
                        .join(", ")}
                      .
                    </p>
                  ))}
                </li>
              ))}
            </ul>
            <p>
              Coordinates: {terminal.location.latitude},{" "}
              {terminal.location.longitude}.
            </p>
            {terminal.vesselWatchUrl ? (
              <p>
                <a href={terminal.vesselWatchUrl}>WSF vessel watch</a>
              </p>
            ) : null}
          </details>
          {bulletins.map((bulletin) => (
            <PublicBulletin
              key={`${bulletin.date}:${bulletin.title}`}
              bulletin={bulletin}
            />
          ))}
        </>
      ) : (
        <p>
          Terminal details are not available from their authoritative source.
        </p>
      )}
      {/* preserve an available ad when the terminal source is missing */}
      {!terminal && <PublicAd className="my-4" />}
    </SsrPage>
  );
};

/** Anonymous terminal index, intentionally free of geolocation and preferences. */
// render public home
export const PublicHome = (): ReactElement => {
  const terminals = usePublicSsrSource("terminals") ?? [];
  const features = usePublicSsrSource("features");
  return (
    <main className="relative min-h-screen min-h-[100dvh] overflow-y-scroll scrolling-touch bg-ferry-gradient text-white">
      <SnapshotSeoHelmet fallback={getSeoMetadata("/")} />
      <HomeHero leaderboardsEnabled={features?.leaderboardsEnabled ?? false} />
      {/* use the same content-owned ad spacing before hydration */}
      <div className="px-4">
        <PublicAd className="mx-auto w-full max-w-6xl py-4" />
      </div>
      <div className="mx-auto w-full max-w-6xl px-6 pb-4">
        <SnapshotFreshness
          primarySource="terminals"
          sources={[
            { key: "terminals", label: "Terminal directory" },
            { key: "features", label: "Public feature availability" },
            { key: "notices", label: "Service notices" },
          ]}
        />
      </div>
      <div className="px-6">
        <PublicNotices />
        <PublicRouteNavigation />
      </div>
      <HomeTerminalDirectory terminals={[...terminals]} />
      <section className="mx-auto w-full max-w-6xl px-6 pb-8">
        <h2>Terminal locations</h2>
        <ul>
          {terminals.map((terminal) => (
            <li key={terminal.id}>
              {terminal.name}:{" "}
              {[
                terminal.location.address?.line1,
                terminal.location.address?.line2,
                terminal.location.address?.city,
                terminal.location.address?.state,
                terminal.location.address?.zip,
              ]
                .filter(Boolean)
                .join(", ")}{" "}
              · {terminal.location.latitude}, {terminal.location.longitude}.
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
};
