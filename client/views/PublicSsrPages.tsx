import { DateTime } from "luxon";
import React, { type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { CrossingEstimate } from "shared/contracts/schedules";
import type {
  PublicSsrSnapshot,
  PublicSsrSourceKey,
} from "shared/contracts/ssr";
import { getSeoMetadata, type SeoMetadata } from "shared/lib/seo";

import { AdCreativeCard } from "~/components/AdCreativeCard";
import { CameraImageFooter } from "~/components/CameraImageFooter";
import { HomeHero } from "~/components/HomeHero";
import { HomeTerminalDirectory } from "~/components/HomeTerminalDirectory";
import { SeoHelmet } from "~/components/SeoHelmet";
import { SsrPage } from "~/components/SsrPage";
import { useAppRenderContext } from "~/lib/renderContext";
import {
  getPublicSsrSourceOutcome,
  usePublicSsrSnapshot,
  usePublicSsrSource,
  usePublicSsrSourceOutcome,
} from "~/lib/ssrSeed";

function formatSnapshotTime(value: string): string {
  return DateTime.fromISO(value, { zone: "America/Los_Angeles" }).toFormat(
    "MMM d, h:mm a ZZZZ"
  );
}

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

function formatForecast(estimate: CrossingEstimate | undefined): string {
  if (!estimate) {
    return "";
  }
  const capacity =
    estimate.driveUpCapacity + (estimate.reservableCapacity ?? 0);
  const risk = estimate.fullRisk ? `, ${estimate.fullRisk} full risk` : "";
  return ` — forecast ${capacity} vehicle spaces${risk}`;
}

const UNAVAILABLE_REASON_LABELS = {
  "not-published": "not published",
  "not-supported": "not supported",
  "source-unavailable": "source unavailable",
} as const;

type SnapshotSourceDescriptor = {
  key: PublicSsrSourceKey;
  label: string;
};

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

const PublicNotices = ({
  includeBulletins = false,
}: {
  includeBulletins?: boolean;
}): ReactElement | null => {
  const notices = usePublicSsrSource("notices");
  const bulletinsSource = usePublicSsrSource("bulletins") ?? [];
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
        <section key={`${bulletin.date}:${bulletin.title}`}>
          <h2>{bulletin.title}</h2>
          <p>{bulletin.bodyText}</p>
        </section>
      ))}
    </aside>
  );
};

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

/** Anonymous portions of interactive pages; native/account controls mount later. */
export const PublicTickets = (): ReactElement => {
  const guidance = usePublicSsrSource("ticketGuidance");
  return (
    <SsrPage>
      <SnapshotSeoHelmet fallback={getSeoMetadata("/tickets")} />
      <p>
        {guidance?.guidance.body ?? "Ticket tools load after the app is ready."}
      </p>
      {guidance ? (
        <p className="mt-3 text-sm">
          Saved tickets and ticket lookup become available after the app is
          ready. Scanner availability: {guidance.capabilities.barcodeScanner}.
        </p>
      ) : null}
    </SsrPage>
  );
};

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
      {features?.leaderboardsEnabled === false ? (
        <p>Public leaderboards are currently disabled.</p>
      ) : null}
      {board ? <h2>{board.entity.label}</h2> : null}
      {board?.ranks.length ? (
        <ol>
          {board.ranks.map((rank) => (
            <li key={`${rank.rank}:${rank.label}`}>
              {rank.rank}. {rank.label} — {rank.score}
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
      <p>{guidanceBody}</p>
      <p className="mt-3 text-sm">
        Alert subscriptions are personal and load only after sign-in.
      </p>
    </SsrPage>
  );
};

/** Anonymous map fallback that keeps live vessel context visible without Mapbox. */
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
      <p>
        {route
          ? `Live vessel positions for ${route.terminal.name} and ${route.mate.name}.`
          : "Live vessel positions load after the app is ready."}
      </p>
      <ul>
        {(vessels ?? []).map((vessel) => (
          <li key={vessel.id}>
            {vessel.name}
            {vessel.location
              ? ` — ${vessel.location.latitude.toFixed(3)}, ${vessel.location.longitude.toFixed(3)}`
              : ""}
          </li>
        ))}
      </ul>
      {vesselOutcomeNotice}
    </SsrPage>
  );
};

/** Seeded official fare catalogue summary; the interactive calculator follows hydration. */
export const PublicFares = (): ReactElement => {
  const fares = usePublicSsrSource("fares");
  const route = usePublicSsrSource("route");
  const fareOutcome = usePublicSsrSourceOutcome("fares");
  const catalog = fares?.state === "current" ? fares.catalog : null;
  let fareContent: ReactElement;
  if (catalog) {
    fareContent = (
      <ul>
        {catalog.fares.map((fare) => (
          <li key={fare.id}>
            {fare.label} — ${fare.amount.toFixed(2)}
          </li>
        ))}
      </ul>
    );
  } else if (fares?.state === "no-fare") {
    fareContent = (
      <p>{fares.noFare.message ?? "No fare is collected in this direction."}</p>
    );
  } else if (fareOutcome?.outcome === "authoritatively-unavailable") {
    fareContent = (
      <p>Official fare data is not available for this route and date.</p>
    );
  } else {
    fareContent = <p>Fare details load after the app is ready.</p>;
  }
  return (
    <SsrPage>
      <SnapshotSeoHelmet fallback={getSeoMetadata("/")} />
      <h1>Fare estimator</h1>
      <p>
        {route
          ? `Official WSDOT fares for ${route.terminal.name} to ${route.mate.name}.`
          : "Official WSDOT fare information."}
      </p>
      <SnapshotFreshness
        primarySource="fares"
        sources={[
          { key: "route", label: "Route details" },
          { key: "fares", label: "Official fare data" },
          { key: "notices", label: "Service notices" },
        ]}
      />
      <PublicNotices />
      <PublicAd className="my-4" />
      {fareOutcome?.outcome === "stale-usable" ? (
        <p>The displayed fare catalog is stale; verify prices with WSDOT.</p>
      ) : null}
      {fareContent}
    </SsrPage>
  );
};

/** Server-safe schedule presentation from the complete anonymous schedule source. */
export const PublicSchedule = (): ReactElement => {
  const route = usePublicSsrSource("route");
  const schedule = usePublicSsrSource("schedule")?.schedule;
  const wsf = usePublicSsrSource("wsf");
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
    <SsrPage>
      <SnapshotSeoHelmet fallback={getSeoMetadata("/")} />
      <h1>
        {route
          ? `${route.terminal.name} to ${route.mate.name} schedule`
          : "Ferry schedule"}
      </h1>
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
      <PublicNotices includeBulletins />
      {wsfNotice}
      <PublicAd className="my-4" />
      {schedule ? (
        <ul>
          {schedule.slots.map((slot) => (
            <li key={slot.wuid}>
              {DateTime.fromSeconds(slot.time, {
                zone: "America/Los_Angeles",
              }).toFormat("h:mm a")}
              {slot.crossing?.isCancelled ? " — cancelled" : ""}
              {slot.vessel?.name ? ` — ${slot.vessel.name}` : ""}
              {slot.crossing && !slot.crossing.isCancelled
                ? ` — ${slot.crossing.driveUpCapacity + slot.crossing.reservableCapacity} vehicle spaces reported`
                : ""}
              {formatForecast(slot.estimate)}
            </li>
          ))}
        </ul>
      ) : (
        <p>Schedule data is temporarily unavailable.</p>
      )}
    </SsrPage>
  );
};

export const PublicCameras = (): ReactElement => {
  const snapshot = usePublicSsrSnapshot();
  const route = usePublicSsrSource("route");
  const frames = usePublicSsrSource("cameraFrames");
  const framesOutcome = usePublicSsrSourceOutcome("cameraFrames");
  const cameras = route?.terminal.cameras ?? [];
  const renderedAt = snapshot ? Date.parse(snapshot.renderedAt) / 1000 : NaN;
  return (
    <SsrPage>
      <SnapshotSeoHelmet fallback={getSeoMetadata("/")} />
      <h1>Cameras</h1>
      <SnapshotFreshness
        primarySource="cameraFrames"
        sources={[
          { key: "route", label: "Route details" },
          { key: "cameraFrames", label: "Camera data" },
          { key: "notices", label: "Service notices" },
        ]}
      />
      <PublicNotices />
      <PublicAd className="my-4" />
      {cameras.length ? (
        <ul>
          {cameras.map((camera) => {
            const frame = frames?.frames[camera.id];
            let frameStatus = "Camera image status was not reported.";
            if (frame?.isStale) {
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
                <h2>{camera.title}</h2>
                <div className="relative w-full max-w-[480px] overflow-hidden">
                  <img
                    alt={camera.title}
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
                <p>{frameStatus}</p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>This terminal does not have cameras</p>
      )}
    </SsrPage>
  );
};

export const PublicBulletins = (): ReactElement => {
  const bulletins = usePublicSsrSource("bulletins") ?? [];
  const route = usePublicSsrSource("route");
  const bulletinsOutcome = usePublicSsrSourceOutcome("bulletins");
  let bulletinContent: ReactElement;
  if (bulletins.length) {
    bulletinContent = (
      <ul>
        {bulletins.map((bulletin) => (
          <li key={`${bulletin.date}:${bulletin.title}`}>
            <h2>{bulletin.title}</h2>
            <p>{bulletin.bodyText}</p>
          </li>
        ))}
      </ul>
    );
  } else if (bulletinsOutcome?.outcome === "authoritatively-unavailable") {
    bulletinContent = (
      <p>Service alerts are not available from their authoritative source.</p>
    );
  } else {
    bulletinContent = <p>No active alerts</p>;
  }
  return (
    <SsrPage>
      <SnapshotSeoHelmet fallback={getSeoMetadata("/")} />
      <h1>Alerts</h1>
      {route ? (
        <p>
          Public service alerts for {route.terminal.name} to {route.mate.name}.
        </p>
      ) : null}
      <SnapshotFreshness
        primarySource="bulletins"
        sources={[
          { key: "route", label: "Route details" },
          { key: "bulletins", label: "Service alerts" },
          { key: "notices", label: "Service notices" },
        ]}
      />
      <PublicNotices />
      {bulletinContent}
    </SsrPage>
  );
};

export const PublicTerminalDetails = (): ReactElement => {
  const route = usePublicSsrSource("route");
  const terminal = route?.terminal;
  return (
    <SsrPage>
      <SnapshotSeoHelmet fallback={getSeoMetadata("/")} />
      <h1>{terminal?.name ?? "Terminal details"}</h1>
      <SnapshotFreshness
        primarySource="route"
        sources={[
          { key: "route", label: "Terminal details" },
          { key: "notices", label: "Service notices" },
        ]}
      />
      <PublicNotices />
      <PublicAd className="my-4" />
      {terminal ? (
        <>
          <p>
            Routes from {terminal.name}:{" "}
            {terminal.mates.map((mate) => mate.name).join(", ") ||
              "none listed"}
            .
          </p>
          <ul>
            {terminal.hasWaitingRoom ? <li>Waiting room</li> : null}
            {terminal.hasRestroom ? <li>Restrooms</li> : null}
            {terminal.hasFood ? <li>Food available</li> : null}
            {terminal.hasElevator ? <li>Elevator</li> : null}
            {terminal.hasOverheadLoading ? <li>Overhead loading</li> : null}
          </ul>
        </>
      ) : (
        <p>
          Terminal details are not available from their authoritative source.
        </p>
      )}
    </SsrPage>
  );
};

/** Anonymous terminal index, intentionally free of geolocation and preferences. */
export const PublicHome = (): ReactElement => {
  const terminals = usePublicSsrSource("terminals") ?? [];
  const features = usePublicSsrSource("features");
  return (
    <main className="relative min-h-screen min-h-[100dvh] overflow-y-scroll scrolling-touch bg-ferry-gradient text-white">
      <SnapshotSeoHelmet fallback={getSeoMetadata("/")} />
      <HomeHero leaderboardsEnabled={features?.leaderboardsEnabled ?? false} />
      <PublicAd className="mx-auto w-full max-w-6xl px-4 pb-4" />
      <div className="sr-only">
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
      </div>
      <HomeTerminalDirectory terminals={[...terminals]} />
    </main>
  );
};

const EDITORIAL_PAGES: Record<
  | "data-sources"
  | "install"
  | "privacy"
  | "forecasting"
  | "support"
  | "supporter"
  | "terms",
  { body: string; path: string; title: string }
> = {
  "data-sources": {
    body: "Ferry FYI combines Washington State Ferries schedules and service context with weather, tide, historical, and live observations. Preserve displayed source timestamps when citing time-sensitive information.",
    path: "/data-sources",
    title: "Data sources and API guide",
  },
  install: {
    body: "Install Ferry FYI from the App Store on iPhone and iPad, from Google Play on Android, or as an installable web app on desktop browsers.",
    path: "/install",
    title: "Install Ferry FYI",
  },
  support: {
    body: "Questions, inaccurate information, app issues, and ideas are welcome. Email Ferry FYI support with the route or terminal, what happened, and the device you were using when those details are helpful.",
    path: "/support",
    title: "Support",
  },
  forecasting: {
    body: "Vehicle-space, delay, weather, and tide forecasts are estimates, not confirmations of boarding availability, cancellations, or delays.",
    path: "/forecasting",
    title: "Forecast methodology",
  },
  privacy: {
    body: "Ferry FYI keeps account and notification controls private and lets signed-in users permanently delete their account from the Account page. Contextual advertisements may use the route, terminal, or page being viewed, but not account information, precise location, saved tickets, notification settings, or activity across other websites.",
    path: "/privacy",
    title: "Privacy Policy",
  },
  supporter: {
    body: "Ferry FYI Supporter is an optional monthly or yearly subscription that removes Ferry FYI advertisements by default while signed in and can show an optional cosmetic leaderboard badge. Active supporters can voluntarily show ads from Account and turn them off again at any time. Core ferry information remains free.",
    path: "/supporter",
    title: "Ferry FYI Supporter",
  },
  terms: {
    body: "Ferry FYI is an independent trip-planning service. Supporter subscriptions renew until cancelled through the provider that processed the purchase, and deleting a Ferry FYI account does not cancel billing.",
    path: "/terms",
    title: "Terms of Service",
  },
};

/** Indexable editorial content that remains useful before browser-only views load. */
export const PublicEditorialPage = ({
  page,
}: {
  page: keyof typeof EDITORIAL_PAGES;
}): ReactElement => {
  const content = EDITORIAL_PAGES[page];
  return (
    <SsrPage>
      <SnapshotSeoHelmet fallback={getSeoMetadata(content.path)} />
      <h1>{content.title}</h1>
      <p>{content.body}</p>
    </SsrPage>
  );
};
