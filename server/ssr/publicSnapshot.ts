import { DateTime } from "luxon";
import type { GetScheduleResponse } from "shared/api/schedules";
import {
  type AdCampaignCreative,
  type AdSlotId,
  getAdPlacementKey,
} from "shared/contracts/ads";
import type { CameraFrameStatusEnvelope } from "shared/contracts/cameraFrames";
import type { FareTripRequest } from "shared/contracts/fares";
import type { LeaderboardPeriod } from "shared/contracts/leaderboards";
import type {
  CrossingEstimate,
  Schedule,
  SlotTide,
  SlotWeather,
} from "shared/contracts/schedules";
import {
  PUBLIC_SSR_EMPTY_DATA,
  PUBLIC_SSR_SNAPSHOT_VERSION,
  type PublicSsrAlertGuidance,
  type PublicSsrEditorial,
  type PublicSsrFeatures,
  type PublicSsrLeaderboard,
  type PublicSsrLeaderboardIndex,
  type PublicSsrNotices,
  type PublicSsrRoutePayload,
  type PublicSsrSnapshot,
  type PublicSsrSourceKey,
  type PublicSsrTerminal,
  type PublicSsrTerminalSummary,
  type PublicSsrTicketGuidance,
  type PublicSsrVessel,
} from "shared/contracts/ssr";
import type { PublicSsrRouteParams } from "shared/contracts/ssrRouting";
import type { Terminal } from "shared/contracts/terminals";
import TERMINAL_CATALOG from "shared/data/terminals.json";
import {
  getLeaderboardsSeoMetadata,
  getNotFoundSeoMetadata,
  getRouteSeoMetadata,
  getSeoProfile,
  getTerminalLeaderboardSeoMetadata,
  getTerminalSeoMetadata,
  getVesselLeaderboardSeoMetadata,
  type SeoMetadata,
} from "shared/lib/seo";
import { publicQueryCacheKey } from "shared/lib/ssrQueryPolicy";
import {
  createStaticPublicSsrTerminalResolver,
  getPublicSsrHostProfile,
  matchPublicSsrRoute,
  type PublicSsrRouteMatch,
  type PublicSsrTerminalResolver,
} from "shared/lib/ssrRouteMatch";
import { resolvePublicSsrIndexability } from "shared/lib/ssrRoutes";
import { getSsrSailingDayId } from "shared/lib/ssrSailingDay";
import { assertPublicSsrSnapshot } from "shared/lib/ssrValidation";

import type { PublicContent } from "~/services/public/content";
import type { PublicFareCatalogOutcome } from "~/services/public/fares";
import type { PublicScheduleResult } from "~/services/public/schedules";

type CatalogEntry = {
  aliases: string[];
  slug: string;
};
type PublicTerminalCatalog = Record<string, CatalogEntry>;
type SourceUpdatedAt = number | string | null | undefined;

export class PublicSsrTransientFailure extends Error {
  readonly code = "public-ssr-transient-failure";

  constructor(public readonly source: PublicSsrSourceKey) {
    super(`Public SSR source did not settle: ${source}`);
    this.name = "PublicSsrTransientFailure";
  }
}

export type PublicSsrLoadResult =
  | {
      classification: "snapshot";
      match: PublicSsrRouteMatch;
      snapshot: PublicSsrSnapshot;
      sourceDurationsMs?: Readonly<Partial<Record<PublicSsrSourceKey, number>>>;
    }
  | {
      classification: "private";
      match: PublicSsrRouteMatch;
      snapshot: undefined;
    }
  | {
      classification: "redirect";
      match: PublicSsrRouteMatch;
      redirectTo: string;
      snapshot: undefined;
    }
  | {
      classification: "unknown";
      snapshot: undefined;
    };

export interface PublicSsrSnapshotServices {
  getAdCreative(
    placementKey: string,
    now: Date
  ): Promise<AdCampaignCreative | null>;
  getCameraFrames(cameraIds: string[]): Promise<CameraFrameStatusEnvelope>;
  getContent(): Promise<PublicContent>;
  getFareCatalog(input: FareTripRequest): Promise<PublicFareCatalogOutcome>;
  getLeaderboard(input: {
    entityId: string;
    kind: "terminal" | "vessel";
    period: LeaderboardPeriod;
  }): Promise<{
    entityId: string;
    period: LeaderboardPeriod;
    ranks: { label: string; rank: number; score: number }[];
  }>;
  getPublicLeaderboardsEnabled(): Promise<boolean>;
  getSchedule(input: {
    arrivingId: string;
    date: string;
    departingId: string;
  }): Promise<PublicScheduleResult>;
  getTerminals(): Promise<Record<string, Terminal>>;
  getVessels(): Promise<
    Record<string, PublicSsrVessel & Record<string, unknown>>
  >;
  getWsfStatus(): Promise<{
    coreReady?: boolean;
    offline: boolean;
    warming?: boolean;
  }>;
}

export interface PublicSsrSnapshotLoaderInput {
  absoluteUrl: string;
  contentRevision: string;
  fixedClock: Date;
  release: PublicSsrEditorial["release"];
}

export interface PublicSsrSnapshotLoaderDependencies {
  monotonicClock?: () => number;
  services: PublicSsrSnapshotServices;
  terminalCatalog?: PublicTerminalCatalog;
}

const DEFAULT_TICKET_GUIDANCE: PublicSsrTicketGuidance = {
  capabilities: {
    barcodeScanner: "available",
    savedTickets: "after-hydration",
    ticketLookup: "after-hydration",
  },
  guidance: {
    body: "Sign in after the page loads to look up and save eligible tickets.",
    title: "Ferry tickets",
  },
};
const DEFAULT_ALERT_GUIDANCE: PublicSsrAlertGuidance = {
  body: "Sign in after the page loads to manage personal ferry alert rules.",
  title: "Ferry alerts",
};
const AD_SLOT_FOR_VIEW: Partial<
  Record<NonNullable<PublicSsrRouteMatch["route"]["view"]>, AdSlotId>
> = {
  cameras: "cameras",
  fare: "fare",
  schedule: "schedule",
  terminal: "terminal",
};
const iso = (value: SourceUpdatedAt): string | null => {
  if (typeof value === "string") {
    return DateTime.fromISO(value, { setZone: true }).isValid ? value : null;
  }
  return typeof value === "number" && Number.isFinite(value)
    ? DateTime.fromSeconds(value).toUTC().toISO()
    : null;
};
const required = <T>(
  value: T | null | undefined,
  source: PublicSsrSourceKey
): T => {
  if (value === null || value === undefined) {
    throw new PublicSsrTransientFailure(source);
  }
  return value;
};

/** Builds the static public slug resolver without loading models or services. */
export const createPublicSsrTerminalResolver = (
  catalog: PublicTerminalCatalog = TERMINAL_CATALOG as PublicTerminalCatalog
): PublicSsrTerminalResolver => createStaticPublicSsrTerminalResolver(catalog);

const catalogIdForSlug = (
  catalog: PublicTerminalCatalog,
  slug: string
): string | undefined =>
  Object.entries(catalog).find(([, entry]) => entry.slug === slug)?.[0];

export type PublicSsrCanonicalResolution =
  | { classification: "eligible"; match: PublicSsrRouteMatch }
  | { classification: "private"; match: PublicSsrRouteMatch }
  | {
      classification: "redirect";
      match: PublicSsrRouteMatch;
      redirectTo: string;
    }
  | { classification: "unknown" };

/** Resolves public canonical paths before the document cache boundary. */
export const createPublicSsrCanonicalResolver = ({
  getTerminals,
  terminalCatalog = TERMINAL_CATALOG as PublicTerminalCatalog,
}: {
  getTerminals: () => Promise<Record<string, Terminal>>;
  terminalCatalog?: PublicTerminalCatalog;
}) => {
  const terminalResolver = createPublicSsrTerminalResolver(terminalCatalog);
  return async (
    url: URL,
    options: { pureOnly?: boolean } = {}
  ): Promise<PublicSsrCanonicalResolution> => {
    const match = matchPublicSsrRoute(url, terminalResolver);
    if (!match) {
      return { classification: "unknown" };
    }
    if (match.route.kind === "private") {
      return { classification: "private", match };
    }
    if (match.route.kind === "not-found") {
      return { classification: "eligible", match };
    }
    const query = publicQueryCacheKey(match.query);
    const redirect = (pathname: string) => ({
      classification: "redirect" as const,
      match,
      redirectTo: query ? `${pathname}?${query}` : pathname,
    });
    if (
      getPublicSsrHostProfile(url.hostname) === "howmanyboats.today" &&
      url.pathname !== "/"
    ) {
      return match.route.id === "today"
        ? redirect("/")
        : redirect(`https://ferry.fyi${match.canonicalPath}`);
    }
    if (match.route.kind === "redirect") {
      return match.route.redirectTo
        ? redirect(match.route.redirectTo)
        : { classification: "unknown" };
    }
    if (url.pathname !== match.canonicalPath) {
      return redirect(match.canonicalPath);
    }
    if (match.route.kind !== "dynamic") {
      return { classification: "eligible", match };
    }
    const { terminalSlug } = match.params;
    if (!terminalSlug) {
      return { classification: "eligible", match };
    }
    if (match.route.view === "terminal") {
      return match.params.mateSlug
        ? redirect(`/${terminalSlug}/terminal`)
        : { classification: "eligible", match };
    }
    if (options.pureOnly) {
      return { classification: "eligible", match };
    }
    const terminalId = catalogIdForSlug(terminalCatalog, terminalSlug);
    const terminals = await getTerminals();
    const terminal = terminalId ? terminals[terminalId] : undefined;
    if (!terminal) {
      throw new PublicSsrTransientFailure("route");
    }
    const mates = terminal.mates ?? [];
    const suffix =
      match.route.view === "schedule" ? "" : `/${match.route.view}`;
    if (!match.params.mateSlug && mates.length > 1) {
      const mateId = mates[0]?.id;
      const mateSlug = mateId ? terminalCatalog[mateId]?.slug : undefined;
      if (!mateSlug) {
        throw new PublicSsrTransientFailure("route");
      }
      return redirect(`/${terminalSlug}/${mateSlug}${suffix}`);
    }
    if (match.params.mateSlug && mates.length === 1) {
      return redirect(`/${terminalSlug}${suffix}`);
    }
    return { classification: "eligible", match };
  };
};

const toTerminal = (
  terminal: Terminal,
  routeDate: string
): PublicSsrTerminal => {
  const identity = (value: Terminal) => ({
    abbreviation: value.abbreviation,
    id: value.id,
    name: value.name,
  });
  return {
    ...identity(terminal),
    bulletins: terminal.bulletins,
    cameras: terminal.cameras,
    hasElevator: terminal.hasElevator,
    hasFood: terminal.hasFood,
    hasOverheadLoading: terminal.hasOverheadLoading,
    hasRestroom: terminal.hasRestroom,
    hasWaitingRoom: terminal.hasWaitingRoom,
    info: Object.fromEntries(
      Object.entries(terminal.info).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    ),
    location: {
      address: terminal.location.address
        ? {
            city: terminal.location.address.city ?? null,
            line1: terminal.location.address.line1 ?? null,
            line2: terminal.location.address.line2 ?? null,
            state: terminal.location.address.state ?? null,
            zip: terminal.location.address.zip ?? null,
          }
        : null,
      latitude: terminal.location.latitude,
      link: terminal.location.link ?? null,
      longitude: terminal.location.longitude,
    },
    mates: (terminal.mates ?? []).map(identity),
    popularity: terminal.popularity,
    routes: Object.fromEntries(
      Object.entries(terminal.routes ?? {}).map(([id, route]) => [
        id,
        {
          abbreviation: route.abbreviation,
          crossingTime: route.crossingTime,
          date:
            /^\d{4}-\d{2}-\d{2}$/.test(route.date) &&
            DateTime.fromISO(route.date, { zone: "utc" }).isValid
              ? route.date
              : routeDate,
          description: route.description,
          id: route.id,
          terminalIds: route.terminalIds,
          ...(Number.isFinite(route.averageVehicleCapacity)
            ? { averageVehicleCapacity: route.averageVehicleCapacity }
            : {}),
          ...(Array.isArray(route.galleyHours)
            ? { galleyHours: route.galleyHours }
            : {}),
          ...(Number.isFinite(route.normalVehicleCapacity)
            ? { normalVehicleCapacity: route.normalVehicleCapacity }
            : {}),
          ...(Number.isFinite(route.normalVehicleMaxCapacity)
            ? { normalVehicleMaxCapacity: route.normalVehicleMaxCapacity }
            : {}),
        },
      ])
    ),
    terminalUrl: terminal.terminalUrl ?? null,
    vesselWatchUrl: terminal.vesselWatchUrl ?? null,
    waitTimes: terminal.waitTimes.map(({ title, ...waitTime }) => ({
      ...waitTime,
      ...(typeof title === "string" ? { title } : {}),
    })),
  };
};

const toTerminalSummary = (terminal: Terminal): PublicSsrTerminalSummary => ({
  abbreviation: terminal.abbreviation,
  id: terminal.id,
  location: {
    address: terminal.location.address
      ? {
          city: terminal.location.address.city ?? null,
          line1: terminal.location.address.line1 ?? null,
          line2: terminal.location.address.line2 ?? null,
          state: terminal.location.address.state ?? null,
          zip: terminal.location.address.zip ?? null,
        }
      : null,
    latitude: terminal.location.latitude,
    link: terminal.location.link ?? null,
    longitude: terminal.location.longitude,
  },
  name: terminal.name,
});

const cameraFrames = (value: CameraFrameStatusEnvelope) => ({
  frames: Object.fromEntries(
    Object.entries(value.frames).map(([id, frame]) => [
      id,
      {
        cameraId: frame.cameraId,
        checkedAt: frame.checkedAt,
        frameToken: frame.frameToken,
        frameUpdatedAt: frame.frameUpdatedAt,
        imageUrl: frame.imageUrl,
        isStale: frame.isStale,
        status: frame.error ? "unavailable" : "available",
      },
    ])
  ),
  sourceUpdatedAt: value.sourceUpdatedAt,
});

/** Never pass a full model or operational vessel object into the snapshot. */
export const toPublicSsrVessel = (vessel: PublicSsrVessel): PublicSsrVessel => {
  const projected: PublicSsrVessel = {
    abbreviation: vessel.abbreviation,
    id: vessel.id,
    inMaintenance: vessel.inMaintenance,
    inService: vessel.inService,
    name: vessel.name,
    speed: vessel.speed,
  };
  if (vessel.heading !== undefined) {
    projected.heading = vessel.heading;
  }
  if (vessel.isAtDock !== undefined) {
    projected.isAtDock = vessel.isAtDock;
  }
  if (vessel.location !== undefined) {
    projected.location = vessel.location;
  }
  return projected;
};

const toPublicSsrEstimate = (
  estimate: CrossingEstimate
): CrossingEstimate | undefined => {
  if (
    !Number.isFinite(estimate.driveUpCapacity) ||
    !(
      estimate.reservableCapacity === null ||
      Number.isFinite(estimate.reservableCapacity)
    )
  ) {
    return undefined;
  }
  return {
    driveUpCapacity: estimate.driveUpCapacity,
    reservableCapacity: estimate.reservableCapacity,
    ...(estimate.confidence ? { confidence: estimate.confidence } : {}),
    ...(estimate.factors
      ? {
          factors: estimate.factors.map(({ detail, impact, label }) => ({
            detail,
            impact,
            label,
          })),
        }
      : {}),
    ...(Number.isFinite(estimate.fullProbability)
      ? { fullProbability: estimate.fullProbability }
      : {}),
    ...(estimate.fullRisk ? { fullRisk: estimate.fullRisk } : {}),
    ...(estimate.routeClass ? { routeClass: estimate.routeClass } : {}),
    ...(Number.isFinite(estimate.sampleSize)
      ? { sampleSize: estimate.sampleSize }
      : {}),
    ...(estimate.source ? { source: estimate.source } : {}),
  };
};

const toPublicSsrTide = (tide: SlotTide): SlotTide => ({
  stationId: tide.stationId,
  waterLevelM: tide.waterLevelM,
  ...(typeof tide.arrivalStationId === "string"
    ? { arrivalStationId: tide.arrivalStationId }
    : {}),
  ...(tide.arrivalWaterLevelM === null ||
  Number.isFinite(tide.arrivalWaterLevelM)
    ? { arrivalWaterLevelM: tide.arrivalWaterLevelM }
    : {}),
  ...(tide.lowestWaterLevelM === null || Number.isFinite(tide.lowestWaterLevelM)
    ? { lowestWaterLevelM: tide.lowestWaterLevelM }
    : {}),
});

const toPublicSsrWeather = (weather: SlotWeather): SlotWeather => ({
  cloudCoverPercent: weather.cloudCoverPercent,
  highTemperatureC: weather.highTemperatureC,
  precipitationMm: weather.precipitationMm,
  temperatureC: weather.temperatureC,
  windGustKmh: weather.windGustKmh,
  windSpeedKmh: weather.windSpeedKmh,
});

const toPublicSsrScheduleSlot = (
  slot: Schedule["slots"][number]
): Schedule["slots"][number] => {
  const estimate = slot.estimate
    ? toPublicSsrEstimate(slot.estimate)
    : undefined;
  return {
    allowsPassengers: slot.allowsPassengers,
    allowsVehicles: slot.allowsVehicles,
    hasPassed: slot.hasPassed,
    mateId: slot.mateId,
    time: slot.time,
    vessel: {
      abbreviation: slot.vessel.abbreviation,
      id: slot.vessel.id,
      name: slot.vessel.name,
      speed: slot.vessel.speed,
      tallVehicleCapacity: slot.vessel.tallVehicleCapacity,
      vehicleCapacity: slot.vessel.vehicleCapacity,
      vesselWatchUrl: slot.vessel.vesselWatchUrl,
    } as Schedule["slots"][number]["vessel"],
    wuid: slot.wuid,
    ...(Number.isFinite(slot.arrivalTime)
      ? { arrivalTime: slot.arrivalTime }
      : {}),
    ...(slot.cancellationReason === "tidal"
      ? { cancellationReason: slot.cancellationReason }
      : {}),
    ...(slot.crossing
      ? {
          crossing: {
            arrivalId: String(slot.crossing.arrivalId),
            departureDelta: slot.crossing.departureDelta,
            departureId: String(slot.crossing.departureId),
            departureTime: slot.crossing.departureTime,
            driveUpCapacity: slot.crossing.driveUpCapacity,
            hasDriveUp: slot.crossing.hasDriveUp,
            hasReservations: slot.crossing.hasReservations,
            isCancelled: slot.crossing.isCancelled,
            reservableCapacity: slot.crossing.reservableCapacity ?? 0,
            totalCapacity: slot.crossing.totalCapacity,
            ...(Number.isFinite(slot.crossing.capacityReportUpdatedAt)
              ? {
                  capacityReportUpdatedAt:
                    slot.crossing.capacityReportUpdatedAt,
                }
              : {}),
            ...(slot.crossing.vesselId === null ||
            typeof slot.crossing.vesselId === "string"
              ? { vesselId: slot.crossing.vesselId }
              : {}),
            ...(slot.crossing.vesselName === null ||
            typeof slot.crossing.vesselName === "string"
              ? { vesselName: slot.crossing.vesselName }
              : {}),
          },
        }
      : {}),
    ...(estimate ? { estimate } : {}),
    ...(slot.tide ? { tide: toPublicSsrTide(slot.tide) } : {}),
    ...(Number.isFinite(slot.vesselPosition)
      ? { vesselPosition: slot.vesselPosition }
      : {}),
    ...(slot.weather ? { weather: toPublicSsrWeather(slot.weather) } : {}),
  };
};

const toPublicSsrSchedule = ({
  schedule,
  timestamp,
}: {
  schedule: Schedule;
  timestamp: number;
}): GetScheduleResponse => {
  const sourceUpdatedAt =
    Number.isFinite(schedule.sourceUpdatedAt) ||
    schedule.sourceUpdatedAt === null
      ? { sourceUpdatedAt: schedule.sourceUpdatedAt }
      : {};
  return {
    schedule: {
      date: schedule.date,
      key: schedule.key,
      mateId: schedule.mateId,
      slots: schedule.slots.map(toPublicSsrScheduleSlot),
      terminalId: schedule.terminalId,
      validRange: schedule.validRange
        ? { from: schedule.validRange.from, to: schedule.validRange.to }
        : null,
      ...sourceUpdatedAt,
    },
    timestamp,
  };
};

function dateFor(clock: Date, offset = 0): string {
  return DateTime.fromISO(getSsrSailingDayId(clock))
    .plus({ days: offset })
    .toFormat("yyyy-MM-dd");
}

export const createPublicSsrSnapshotLoader = ({
  monotonicClock = () => performance.now(),
  services,
  terminalCatalog = TERMINAL_CATALOG as PublicTerminalCatalog,
}: PublicSsrSnapshotLoaderDependencies) => {
  const resolver = createPublicSsrTerminalResolver(terminalCatalog);
  return async (
    input: PublicSsrSnapshotLoaderInput
  ): Promise<PublicSsrLoadResult> => {
    const url = new URL(input.absoluteUrl);
    const canonicalHost = getPublicSsrHostProfile(url.hostname);
    const match = matchPublicSsrRoute(url, resolver);
    if (!canonicalHost || !match) {
      return { classification: "unknown", snapshot: undefined };
    }
    if (match.route.kind === "private") {
      return { classification: "private", match, snapshot: undefined };
    }
    if (match.route.kind === "redirect") {
      if (!match.route.redirectTo) {
        throw new Error("SSR manifest redirect is missing a destination");
      }
      return {
        classification: "redirect",
        match,
        redirectTo: match.route.redirectTo,
        snapshot: undefined,
      };
    }
    const observedAt = input.fixedClock.toISOString();
    const routeDate = dateFor(input.fixedClock);
    if (match.route.kind === "not-found") {
      const metadata = getNotFoundSeoMetadata();
      const snapshot = assertPublicSsrSnapshot(
        {
          canonicalHost,
          canonicalPath: "/404",
          hostProfile: canonicalHost,
          indexability: "noindex",
          metadata: {
            canonicalPath: metadata.canonicalPath,
            description: metadata.description,
            robots: metadata.robots,
            title: metadata.title,
          },
          normalizedUrl: { path: "/404", query: {} },
          renderedAt: observedAt,
          routeId: "unknown-public-path",
          routeParams: {},
          sources: {},
          version: PUBLIC_SSR_SNAPSHOT_VERSION,
        },
        resolver
      );
      return {
        classification: "snapshot",
        match,
        snapshot,
        sourceDurationsMs: {},
      };
    }
    const sourceDurationsMs: Partial<Record<PublicSsrSourceKey, number>> = {};
    const from = async <T>(
      sourceKey: PublicSsrSourceKey,
      operation: () => Promise<T>
    ) => {
      const started = monotonicClock();
      try {
        return required(await operation(), sourceKey);
      } catch (error) {
        if (error instanceof PublicSsrTransientFailure) {
          throw error;
        }
        throw new PublicSsrTransientFailure(sourceKey);
      } finally {
        sourceDurationsMs[sourceKey] =
          (sourceDurationsMs[sourceKey] ?? 0) +
          Math.max(0, monotonicClock() - started);
      }
    };
    const content = () => from("notices", () => services.getContent());
    const source = <K extends PublicSsrSourceKey>(
      key: K,
      value: unknown,
      sourceUpdatedAt: SourceUpdatedAt = null
    ) => ({
      outcome: "value" as const,
      observedAt,
      sourceUpdatedAt: iso(sourceUpdatedAt),
      value,
    });
    const empty = <K extends keyof typeof PUBLIC_SSR_EMPTY_DATA>(key: K) => ({
      outcome: "empty" as const,
      observedAt,
      sourceUpdatedAt: null,
      value: PUBLIC_SSR_EMPTY_DATA[key],
    });
    const unavailable = () => ({
      outcome: "authoritatively-unavailable" as const,
      observedAt,
      reason: "source-unavailable" as const,
      sourceUpdatedAt: null,
    });
    const transientlyUnavailable = (reason: "refreshing" | "warming") => ({
      outcome: "transiently-unavailable" as const,
      observedAt,
      reason,
      sourceUpdatedAt: null,
    });
    const scheduleSource = (
      key: "nextSchedule" | "schedule",
      result: PublicScheduleResult
    ) => {
      if (result.status === "available") {
        return source(
          key,
          toPublicSsrSchedule(result),
          result.schedule.sourceUpdatedAt
        );
      }
      return result.status === "not-found"
        ? unavailable()
        : transientlyUnavailable(result.status);
    };
    const sources: Record<string, unknown> = {};
    let leaderboardIndexingEnabled = true;
    const notices = async () => {
      const value = await content();
      return {
        announcements: value.announcements,
        maintenance: value.maintenance,
      } satisfies PublicSsrNotices;
    };
    const noticeSource = (value: PublicSsrNotices) =>
      value.announcements.length === 0 &&
      !value.maintenance.enabled &&
      value.maintenance.message === ""
        ? empty("notices")
        : source("notices", value);
    const adSource = async (placementKey: string) =>
      source(
        "ad",
        await from("ad", async () => ({
          creative: await services.getAdCreative(
            placementKey,
            input.fixedClock
          ),
          placementKey,
        }))
      );
    const editorial = (): PublicSsrEditorial => ({
      contentRevision: input.contentRevision,
      release: input.release,
    });
    const terminals = () => from("terminals", () => services.getTerminals());
    const routeSeed = async (): Promise<{
      payload: PublicSsrRoutePayload;
      terminal: Terminal;
      mate: Terminal;
    }> => {
      const all = await terminals();
      const terminalId = required(
        catalogIdForSlug(
          terminalCatalog,
          required(match.params.terminalSlug, "route")
        ),
        "route"
      );
      const terminal = required(all[terminalId], "route");
      const mate = match.params.mateSlug
        ? required(
            all[
              required(
                catalogIdForSlug(terminalCatalog, match.params.mateSlug),
                "route"
              )
            ],
            "route"
          )
        : required(all[required(terminal.mates?.[0]?.id, "route")], "route");
      if (!(terminal.mates ?? []).some(({ id }) => id === mate.id)) {
        throw new PublicSsrTransientFailure("route");
      }
      return {
        mate,
        payload: {
          mate: toTerminal(mate, routeDate),
          terminal: toTerminal(terminal, routeDate),
        },
        terminal,
      };
    };
    type RouteSeed = Awaited<ReturnType<typeof routeSeed>>;
    let seedPromise: Promise<RouteSeed> | undefined;
    const route = (): Promise<RouteSeed> => {
      seedPromise ??= routeSeed();
      return seedPromise;
    };

    try {
      switch (match.route.id) {
        case "home": {
          const [all, publicContent, ad] = await Promise.all([
            terminals(),
            content(),
            adSource("home"),
          ]);
          sources.ad = ad;
          sources.terminals = source(
            "terminals",
            Object.values(all).map(toTerminalSummary)
          );
          if (Object.keys(all).length === 0) {
            sources.terminals = empty("terminals");
          }
          sources.features = source("features", {
            leaderboardsEnabled: await from("features", () =>
              services.getPublicLeaderboardsEnabled()
            ),
          } satisfies PublicSsrFeatures);
          const noticePayload = {
            announcements: publicContent.announcements,
            maintenance: publicContent.maintenance,
          } satisfies PublicSsrNotices;
          sources.notices = noticeSource(noticePayload);
          break;
        }
        case "tickets":
          sources.editorial = source("editorial", editorial());
          sources.ticketGuidance = source(
            "ticketGuidance",
            DEFAULT_TICKET_GUIDANCE
          );
          break;
        case "about":
        case "data-sources":
        case "privacy":
        case "forecasting":
        case "feedback":
          sources.editorial = source("editorial", editorial());
          break;
        case "today": {
          const all = await terminals();
          const terminal = required(all["5"], "route");
          const mateIdentity = required(
            (terminal.mates ?? []).find(
              ({ id }) => id === "10" || id === "246"
            ) ?? terminal.mates?.[0],
            "route"
          );
          const mate = required(all[mateIdentity.id], "route");
          const [current, next, status, publicNotices] = await Promise.all([
            from("schedule", () =>
              services.getSchedule({
                arrivingId: mate.id,
                date: dateFor(input.fixedClock),
                departingId: terminal.id,
              })
            ),
            from("nextSchedule", () =>
              services.getSchedule({
                arrivingId: mate.id,
                date: dateFor(input.fixedClock, 1),
                departingId: terminal.id,
              })
            ),
            from("wsf", () => services.getWsfStatus()),
            notices(),
          ]);
          sources.route = source("route", {
            mate: toTerminal(mate, routeDate),
            terminal: toTerminal(terminal, routeDate),
          });
          sources.schedule = scheduleSource("schedule", current);
          sources.nextSchedule = scheduleSource("nextSchedule", next);
          sources.wsf = source("wsf", status);
          sources.notices = noticeSource(publicNotices);
          break;
        }
        case "leaderboards":
        case "leaderboards-terminal":
        case "leaderboards-vessel": {
          const enabled = await from("features", () =>
            services.getPublicLeaderboardsEnabled()
          );
          sources.features = source("features", {
            leaderboardsEnabled: enabled,
          });
          if (!enabled) {
            leaderboardIndexingEnabled = false;
            sources.notices = empty("notices");
            if (match.route.id === "leaderboards") {
              sources.leaderboardIndex = empty("leaderboardIndex");
            } else {
              sources.leaderboard = empty("leaderboard");
            }
            break;
          }
          const publicContent = await content();
          const { leaderboardIndexingEnabled: indexingEnabled } = publicContent;
          leaderboardIndexingEnabled = indexingEnabled;
          const noticePayload = {
            announcements: publicContent.announcements,
            maintenance: publicContent.maintenance,
          } satisfies PublicSsrNotices;
          sources.notices = noticeSource(noticePayload);
          if (match.route.id === "leaderboards") {
            const all = await terminals();
            const vessels = await from("leaderboardIndex", () =>
              services.getVessels()
            );
            const entities = [
              ...Object.values(all).map((terminal) => ({
                id: terminal.id,
                kind: "terminal" as const,
                label: terminal.name,
              })),
              ...Object.values(vessels).map((vessel) => ({
                id: vessel.id,
                kind: "vessel" as const,
                label: vessel.name,
              })),
            ];
            const leaderboardIndex = {
              defaultPeriod: "all",
              entities,
            } satisfies PublicSsrLeaderboardIndex;
            sources.leaderboardIndex = leaderboardIndex.entities.length
              ? source("leaderboardIndex", leaderboardIndex)
              : empty("leaderboardIndex");
          } else {
            const kind =
              match.route.id === "leaderboards-terminal"
                ? "terminal"
                : "vessel";
            const entityId = required(
              kind === "terminal"
                ? match.params.terminalId
                : match.params.vesselId,
              "leaderboard"
            );
            const entities =
              kind === "terminal"
                ? await terminals()
                : await from("leaderboard", () => services.getVessels());
            const entity = required(entities[entityId], "leaderboard");
            const leaderboard = await from("leaderboard", () =>
              services.getLeaderboard({
                entityId,
                kind,
                period: "all",
              })
            );
            sources.leaderboard = source("leaderboard", {
              ...leaderboard,
              entity: { id: entityId, kind, label: entity.name },
            } satisfies PublicSsrLeaderboard);
          }
          break;
        }
        default: {
          const selected = await route();
          const terminalSlug =
            terminalCatalog[selected.terminal.id]?.slug ??
            match.params.terminalSlug!;
          const mateSlug =
            terminalCatalog[selected.mate.id]?.slug ?? match.params.mateSlug;
          const suffix =
            match.route.view === "schedule" ? "" : `/${match.route.view}`;
          const safeQuery = publicQueryCacheKey(match.query);
          const redirect = (pathname: string) =>
            safeQuery ? `${pathname}?${safeQuery}` : pathname;
          if (match.route.view === "terminal" && match.params.mateSlug) {
            return {
              classification: "redirect",
              match,
              redirectTo: redirect(`/${terminalSlug}/terminal`),
              snapshot: undefined,
            };
          }
          if (
            match.route.view !== "terminal" &&
            !match.params.mateSlug &&
            (selected.terminal.mates ?? []).length > 1
          ) {
            return {
              classification: "redirect",
              match,
              redirectTo: redirect(`/${terminalSlug}/${mateSlug}${suffix}`),
              snapshot: undefined,
            };
          }
          if (
            match.route.view !== "terminal" &&
            match.params.mateSlug &&
            (selected.terminal.mates ?? []).length === 1
          ) {
            return {
              classification: "redirect",
              match,
              redirectTo: redirect(`/${terminalSlug}${suffix}`),
              snapshot: undefined,
            };
          }
          sources.route = source("route", selected.payload);
          const adSlot = match.route.view
            ? AD_SLOT_FOR_VIEW[match.route.view]
            : undefined;
          if (adSlot) {
            sources.ad = await adSource(
              getAdPlacementKey({
                arrivalTerminalId: selected.mate.id,
                departureTerminalId: selected.terminal.id,
                slot: adSlot,
              })
            );
          }
          if (match.route.view === "schedule") {
            const date = match.query.values.date ?? dateFor(input.fixedClock);
            const [current, next, status, publicNotices] = await Promise.all([
              from("schedule", () =>
                services.getSchedule({
                  arrivingId: selected.mate.id,
                  date,
                  departingId: selected.terminal.id,
                })
              ),
              from("nextSchedule", () =>
                services.getSchedule({
                  arrivingId: selected.mate.id,
                  date: DateTime.fromISO(date)
                    .plus({ days: 1 })
                    .toFormat("yyyy-MM-dd"),
                  departingId: selected.terminal.id,
                })
              ),
              from("wsf", () => services.getWsfStatus()),
              notices(),
            ]);
            sources.schedule = scheduleSource("schedule", current);
            sources.nextSchedule = scheduleSource("nextSchedule", next);
            sources.wsf = source("wsf", status);
            sources.bulletins = selected.terminal.bulletins.length
              ? source("bulletins", selected.terminal.bulletins)
              : empty("bulletins");
            sources.notices = noticeSource(publicNotices);
          } else if (match.route.view === "cameras") {
            const [frames, publicNotices] = await Promise.all([
              from("cameraFrames", () =>
                services.getCameraFrames(
                  selected.terminal.cameras.map(({ id }) => id)
                )
              ),
              notices(),
            ]);
            const framePayload = cameraFrames(frames);
            sources.cameraFrames =
              Object.keys(framePayload.frames).length === 0 &&
              framePayload.sourceUpdatedAt === null
                ? empty("cameraFrames")
                : source("cameraFrames", framePayload, frames.sourceUpdatedAt);
            sources.notices = noticeSource(publicNotices);
          } else if (match.route.view === "fare") {
            const tripDate = dateFor(
              input.fixedClock
            ) as FareTripRequest["tripDate"];
            const fare = await from("fares", () =>
              services.getFareCatalog({
                arrivingTerminalId: selected.mate.id,
                departingTerminalId: selected.terminal.id,
                roundTrip: false,
                tripDate,
              })
            );
            if (fare.kind === "catalog") {
              sources.fares = source(
                "fares",
                { catalog: fare.catalog, state: "current" },
                fare.catalog.freshness.fetchedAt
              );
            } else if (fare.kind === "no-fare") {
              sources.fares = source(
                "fares",
                { noFare: fare.noFare, state: "no-fare" },
                fare.noFare.freshness.fetchedAt
              );
            } else if (fare.reason === "policy") {
              // A reviewed-policy gap is a stable publishing decision until
              // that policy is updated. Operational/provider failures are not
              // authoritative absence and must fail the fill so it can retry.
              sources.fares = {
                outcome: "authoritatively-unavailable",
                observedAt,
                reason: "not-published",
                sourceUpdatedAt: null,
              };
            } else {
              throw new PublicSsrTransientFailure("fares");
            }
            sources.notices = noticeSource(await notices());
          } else if (match.route.view === "map") {
            const routeSchedule = await from("vessels", () =>
              services.getSchedule({
                arrivingId: selected.mate.id,
                date: match.query.values.date ?? dateFor(input.fixedClock),
                departingId: selected.terminal.id,
              })
            );
            if (routeSchedule.status === "available") {
              const assignedVesselIds = new Set(
                routeSchedule.schedule.slots
                  .map(({ vessel }) => vessel.id)
                  .filter(Boolean)
              );
              const assignedVessels =
                assignedVesselIds.size === 0
                  ? []
                  : Object.values(
                      await from("vessels", () => services.getVessels())
                    ).filter(({ id }) => assignedVesselIds.has(id));
              sources.vessels = assignedVessels.length
                ? source("vessels", assignedVessels.map(toPublicSsrVessel))
                : empty("vessels");
            } else if (routeSchedule.status === "not-found") {
              sources.vessels = unavailable();
            } else {
              sources.vessels = transientlyUnavailable(routeSchedule.status);
            }
            sources.notices = noticeSource(await notices());
          } else if (match.route.view === "alerts") {
            sources.bulletins = selected.terminal.bulletins.length
              ? source("bulletins", selected.terminal.bulletins)
              : empty("bulletins");
            sources.notices = noticeSource(await notices());
          } else if (match.route.view === "subscribe") {
            sources.alertGuidance = source(
              "alertGuidance",
              DEFAULT_ALERT_GUIDANCE
            );
            sources.notices = noticeSource(await notices());
          } else {
            sources.notices = noticeSource(await notices());
          }
        }
      }
    } catch (error) {
      if (error instanceof PublicSsrTransientFailure) {
        throw error;
      }
      throw new PublicSsrTransientFailure("route");
    }
    const selectedSeed = seedPromise ? await seedPromise : undefined;
    const mateSlug = selectedSeed
      ? terminalCatalog[selectedSeed.mate.id]?.slug
      : undefined;
    let dynamicSeo: SeoMetadata | undefined;
    if (selectedSeed && match.route.id !== "today") {
      if (match.route.view === "terminal") {
        dynamicSeo = getTerminalSeoMetadata({
          name: selectedSeed.terminal.name,
          slug: match.params.terminalSlug!,
        });
      } else {
        dynamicSeo = getRouteSeoMetadata(
          {
            mates: selectedSeed.terminal.mates ?? [],
            name: selectedSeed.terminal.name,
            slug: match.params.terminalSlug!,
          },
          { name: selectedSeed.mate.name, slug: required(mateSlug, "route") },
          match.route.view!,
          Boolean(match.query.values.date)
        );
      }
    }
    let leaderboardSeo: SeoMetadata | undefined;
    if (match.route.id === "leaderboards") {
      leaderboardSeo = getLeaderboardsSeoMetadata();
    } else if (
      match.route.id === "leaderboards-terminal" &&
      (sources.leaderboard as { outcome?: string } | undefined)?.outcome ===
        "value"
    ) {
      leaderboardSeo = getTerminalLeaderboardSeoMetadata({
        id: match.params.terminalId!,
        name: (sources.leaderboard as { value: PublicSsrLeaderboard }).value
          .entity.label,
      });
    } else if (
      match.route.id === "leaderboards-vessel" &&
      (sources.leaderboard as { outcome?: string } | undefined)?.outcome ===
        "value"
    ) {
      leaderboardSeo = getVesselLeaderboardSeoMetadata({
        id: match.params.vesselId!,
        name: (sources.leaderboard as { value: PublicSsrLeaderboard }).value
          .entity.label,
      });
    }
    const profile = getSeoProfile(canonicalHost, match.canonicalPath);
    const metadata: SeoMetadata =
      dynamicSeo ?? leaderboardSeo ?? profile.metadata;
    const publicLeaderboards =
      (sources.features as { value?: PublicSsrFeatures } | undefined)?.value
        ?.leaderboardsEnabled && leaderboardIndexingEnabled;
    const indexability = resolvePublicSsrIndexability(
      match.route,
      metadata,
      publicLeaderboards
    );
    const snapshot = assertPublicSsrSnapshot(
      {
        canonicalHost,
        canonicalPath: metadata.canonicalPath,
        hostProfile: canonicalHost,
        indexability,
        metadata: {
          canonicalPath: metadata.canonicalPath,
          description: metadata.description,
          robots:
            indexability === "indexable" ? "index,follow" : "noindex,follow",
          title: metadata.title,
        },
        normalizedUrl: {
          path: metadata.canonicalPath,
          query: match.query.values,
        },
        renderedAt: observedAt,
        routeId: match.route.id,
        routeParams: match.params as PublicSsrRouteParams,
        sources,
        version: PUBLIC_SSR_SNAPSHOT_VERSION,
      },
      resolver
    );
    return { classification: "snapshot", match, snapshot, sourceDurationsMs };
  };
};
