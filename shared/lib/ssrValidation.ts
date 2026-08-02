import { DateTime } from "luxon";

import {
  PUBLIC_SSR_EMPTY_DATA,
  PUBLIC_SSR_FORBIDDEN_KEYS,
  PUBLIC_SSR_SNAPSHOT_VERSION,
  type PublicSsrSnapshot,
} from "../contracts/ssr";
import type {
  PublicSsrRouteId,
  PublicSsrRouteParams,
  PublicSsrSourceKey,
} from "../contracts/ssrRouting";
import { getNotFoundSeoMetadata, getSeoProfile } from "./seo";
import {
  assertPublicSsrRouteCoherence,
  createStaticPublicSsrTerminalResolver,
  type PublicSsrTerminalResolver,
} from "./ssrRouteMatch";
import { getPublicSsrRouteDefinition } from "./ssrRoutes";

type RecordValue = Record<string, unknown>;
const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const string = (value: unknown): value is string => typeof value === "string";
const nullable = (validator: (value: unknown) => boolean) => (value: unknown) =>
  value === null || validator(value);
const array = (validator: (value: unknown) => boolean) => (value: unknown) =>
  Array.isArray(value) && value.every(validator);
const iso = (value: unknown): value is string =>
  string(value) && DateTime.fromISO(value, { setZone: true }).isValid;
const date = (value: unknown) =>
  string(value) &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  DateTime.fromISO(value, { zone: "utc" }).isValid;
const oneOf =
  <T extends readonly string[]>(values: T) =>
  (value: unknown) =>
    string(value) && values.includes(value);
const exact = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
) =>
  object(value) &&
  required.every((key) => hasOwn(value, key)) &&
  Object.keys(value).every(
    (key) => required.includes(key) || optional.includes(key)
  );
const fields = (
  value: unknown,
  required: Record<string, (value: unknown) => boolean>,
  optional: Record<string, (value: unknown) => boolean> = {}
) =>
  exact(value, Object.keys(required), Object.keys(optional)) &&
  Object.entries(required).every(([key, validator]) =>
    validator((value as RecordValue)[key])
  ) &&
  Object.entries(optional).every(
    ([key, validator]) =>
      !hasOwn(value as RecordValue, key) ||
      validator((value as RecordValue)[key])
  );
const stable = (value: unknown) => JSON.stringify(value);

const scanForbidden = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(scanForbidden);
    return;
  }
  if (!object(value)) {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if ((PUBLIC_SSR_FORBIDDEN_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Public SSR snapshot contains forbidden key: ${key}`);
    }
    scanForbidden(nested);
  }
};
const map = (validator: (value: unknown) => boolean) => (value: unknown) =>
  object(value) && Object.values(value).every(validator);
const id = string;
const point = (value: unknown) =>
  fields(value, { latitude: finite, longitude: finite });
const bulletin = (value: unknown) =>
  fields(
    value,
    {
      bodyHTML: string,
      bodyText: string,
      date: finite,
      level: oneOf(["low", "info", "high"]),
      routePrefix: string,
      terminalId: string,
      title: string,
    },
    { url: string }
  );
const camera = (value: unknown) =>
  fields(value, {
    carCapacity: nullable(finite),
    carsToBoat: nullable(finite),
    id,
    image: (item) =>
      fields(item, { height: finite, url: string, width: finite }),
    isActive: (item) => typeof item === "boolean",
    location: point,
    orderFromTerminal: finite,
    owner: nullable((item) => fields(item, { name: string, url: string })),
    terminalId: string,
    title: string,
  });
const route = (value: unknown) =>
  fields(
    value,
    {
      abbreviation: string,
      crossingTime: finite,
      date,
      description: string,
      id,
      terminalIds: array(string),
    },
    {
      averageVehicleCapacity: finite,
      galleyHours: array((item) =>
        fields(item, {
          days: array(finite),
          endTime: string,
          startTime: string,
          vesselPosition: finite,
        })
      ),
      normalVehicleCapacity: finite,
      normalVehicleMaxCapacity: finite,
    }
  );
const identity = (value: unknown) =>
  fields(value, { abbreviation: string, id, name: string });
const terminalLocation = (value: unknown) =>
  fields(value, {
    address: nullable((address) =>
      fields(address, {
        city: nullable(string),
        line1: nullable(string),
        line2: nullable(string),
        state: nullable(string),
        zip: nullable(string),
      })
    ),
    latitude: finite,
    link: nullable(string),
    longitude: finite,
  });
const terminalSummary = (value: unknown) =>
  fields(value, {
    abbreviation: string,
    id,
    location: terminalLocation,
    name: string,
  });
const terminal = (value: unknown): boolean =>
  fields(value, {
    abbreviation: string,
    bulletins: array(bulletin),
    cameras: array(camera),
    hasElevator: (item) => typeof item === "boolean",
    hasFood: (item) => typeof item === "boolean",
    hasOverheadLoading: (item) => typeof item === "boolean",
    hasRestroom: (item) => typeof item === "boolean",
    hasWaitingRoom: (item) => typeof item === "boolean",
    id,
    info: (item) =>
      fields(
        item,
        {},
        {
          ada: string,
          airport: string,
          bicycle: string,
          construction: string,
          food: string,
          lost: string,
          motorcycle: string,
          parking: string,
          security: string,
          train: string,
          truck: string,
        }
      ),
    location: terminalLocation,
    mates: array(identity),
    name: string,
    popularity: finite,
    routes: map(route),
    terminalUrl: nullable(string),
    vesselWatchUrl: nullable(string),
    waitTimes: array((item) =>
      fields(item, { description: string, time: finite }, { title: string })
    ),
  });
const vessel = (value: unknown) =>
  fields(
    value,
    {
      abbreviation: string,
      id,
      inMaintenance: (item) => typeof item === "boolean",
      inService: (item) => typeof item === "boolean",
      name: string,
      speed: finite,
    },
    {
      heading: finite,
      isAtDock: (item) => typeof item === "boolean",
      location: point,
    }
  );
const forecast = (value: unknown) =>
  fields(
    value,
    { driveUpCapacity: finite, reservableCapacity: nullable(finite) },
    {
      confidence: oneOf(["low", "medium", "high"]),
      factors: array((item) =>
        fields(item, {
          detail: string,
          impact: oneOf(["higher", "lower", "neutral"]),
          label: string,
        })
      ),
      fullProbability: finite,
      fullRisk: oneOf(["low", "unlikely", "likely", "high"]),
      routeClass: oneOf(["high-variance", "reservation", "standard"]),
      sampleSize: finite,
      source: oneOf(["blended", "disruption", "historical", "live"]),
    }
  );
const crossing = (value: unknown) =>
  fields(
    value,
    {
      arrivalId: string,
      departureDelta: nullable(finite),
      departureId: string,
      departureTime: finite,
      driveUpCapacity: finite,
      hasDriveUp: (item) => typeof item === "boolean",
      hasReservations: (item) => typeof item === "boolean",
      isCancelled: (item) => typeof item === "boolean",
      reservableCapacity: finite,
      totalCapacity: finite,
    },
    {
      capacityReportUpdatedAt: nullable(finite),
      vesselId: nullable(string),
      vesselName: nullable(string),
    }
  );
const weather = (value: unknown) =>
  fields(value, {
    cloudCoverPercent: nullable(finite),
    highTemperatureC: nullable(finite),
    precipitationMm: nullable(finite),
    temperatureC: nullable(finite),
    windGustKmh: nullable(finite),
    windSpeedKmh: nullable(finite),
  });
const tide = (value: unknown) =>
  fields(
    value,
    { stationId: string, waterLevelM: nullable(finite) },
    {
      arrivalStationId: string,
      arrivalWaterLevelM: nullable(finite),
      lowestWaterLevelM: nullable(finite),
    }
  );
const scheduleVessel = (value: unknown) =>
  fields(value, {
    abbreviation: string,
    id,
    name: string,
    speed: finite,
    tallVehicleCapacity: finite,
    vehicleCapacity: finite,
    vesselWatchUrl: string,
  });
const slot = (value: unknown) =>
  fields(
    value,
    {
      allowsPassengers: (item) => typeof item === "boolean",
      allowsVehicles: (item) => typeof item === "boolean",
      hasPassed: (item) => typeof item === "boolean",
      mateId: string,
      time: finite,
      vessel: scheduleVessel,
      wuid: string,
    },
    {
      arrivalTime: finite,
      cancellationReason: (item) => item === "tidal",
      crossing,
      estimate: forecast,
      tide,
      vesselPosition: finite,
      weather,
    }
  );
const schedule = (value: unknown) =>
  fields(value, {
    schedule: (item) =>
      fields(
        item,
        {
          date,
          key: string,
          mateId: string,
          slots: array(slot),
          terminalId: string,
          validRange: nullable((range) =>
            fields(range, { from: finite, to: finite })
          ),
        },
        { sourceUpdatedAt: nullable(finite) }
      ),
    timestamp: finite,
  });
const cameraFrames = (value: unknown) =>
  fields(value, {
    frames: map((frame) =>
      fields(frame, {
        cameraId: string,
        checkedAt: finite,
        frameToken: nullable(string),
        frameUpdatedAt: nullable(finite),
        imageUrl: string,
        isStale: (item) => typeof item === "boolean",
        status: oneOf(["available", "unavailable"]),
      })
    ),
    sourceUpdatedAt: nullable(finite),
  });
const freshness = (value: unknown) =>
  fields(value, {
    fetchedAt: finite,
    policyVersion: string,
    sourceCacheFlushDate: nullable(string),
    validFrom: date,
    validThrough: date,
  });
const fareRequest = (value: unknown) =>
  fields(value, {
    arrivingTerminalId: string,
    departingTerminalId: string,
    roundTrip: (item) => typeof item === "boolean",
    tripDate: date,
  });
const fares = (value: unknown) =>
  object(value) &&
  (value.state === "current"
    ? fields(value, {
        catalog: (catalog) =>
          fields(catalog, {
            collectionDescription: nullable(string),
            fares: array((fare) =>
              fields(fare, {
                amount: finite,
                category: string,
                directionIndependent: (item) => typeof item === "boolean",
                id: finite,
                label: string,
              })
            ),
            freshness,
            kind: (item) => item === "catalog",
            request: fareRequest,
          }),
        state: (item) => item === "current",
      })
    : value.state === "no-fare" &&
      fields(value, {
        noFare: (noFare) =>
          fields(noFare, {
            freshness,
            kind: (item) => item === "no-fare",
            message: nullable(string),
            request: fareRequest,
            sourceUrl: nullable(string),
          }),
        state: (item) => item === "no-fare",
      }));
const notices = (value: unknown) =>
  fields(value, {
    announcements: array((item) =>
      fields(item, { body: string, id, title: string })
    ),
    maintenance: (item) =>
      fields(item, {
        enabled: (enabled) => typeof enabled === "boolean",
        message: string,
      }),
  });
const leaderboardEntity = (value: unknown) =>
  fields(value, {
    id,
    kind: oneOf(["system", "terminal", "vessel"]),
    label: string,
  });
const publicPayload = (key: PublicSsrSourceKey, value: unknown): boolean =>
  ({
    terminals: array(terminalSummary),
    features: (item: unknown) =>
      fields(item, {
        leaderboardsEnabled: (enabled) => typeof enabled === "boolean",
      }),
    editorial: (item: unknown) =>
      fields(item, {
        contentRevision: string,
        release: (release) =>
          fields(release, { publishedAt: nullable(iso), version: string }),
      }),
    ticketGuidance: (item: unknown) =>
      fields(item, {
        capabilities: (caps) =>
          fields(caps, {
            barcodeScanner: oneOf(["available", "unavailable"]),
            savedTickets: (saved) => saved === "after-hydration",
            ticketLookup: (lookup) => lookup === "after-hydration",
          }),
        guidance: (guidance) =>
          fields(guidance, { body: string, title: string }),
      }),
    notices,
    route: (item: unknown) => fields(item, { mate: terminal, terminal }),
    schedule,
    nextSchedule: schedule,
    wsf: (item: unknown) =>
      fields(
        item,
        { offline: (offline) => typeof offline === "boolean" },
        {
          coreReady: (ready) => typeof ready === "boolean",
          warming: (warming) => typeof warming === "boolean",
        }
      ),
    bulletins: array(bulletin),
    cameraFrames,
    fares,
    vessels: array(vessel),
    alertGuidance: (item: unknown) =>
      fields(item, { body: string, title: string }),
    leaderboardIndex: (item: unknown) =>
      fields(item, {
        defaultPeriod: oneOf(["all", "month", "week"]),
        entities: array(leaderboardEntity),
      }),
    leaderboard: (item: unknown) =>
      fields(item, {
        entity: leaderboardEntity,
        entityId: string,
        period: oneOf(["all", "month", "week"]),
        ranks: array((rank) =>
          fields(rank, { label: string, rank: finite, score: finite })
        ),
      }),
  })[key](value);
const source = (key: PublicSsrSourceKey, value: unknown): boolean => {
  if (
    !object(value) ||
    !iso(value.observedAt) ||
    !(value.sourceUpdatedAt === null || iso(value.sourceUpdatedAt))
  ) {
    return false;
  }
  if (value.outcome === "value") {
    return fields(value, {
      observedAt: iso,
      outcome: (item) => item === "value",
      sourceUpdatedAt: nullable(iso),
      value: (item) => publicPayload(key, item),
    });
  }
  if (value.outcome === "empty") {
    return (
      hasOwn(PUBLIC_SSR_EMPTY_DATA, key) &&
      fields(value, {
        observedAt: iso,
        outcome: (item) => item === "empty",
        sourceUpdatedAt: nullable(iso),
        value: (item) =>
          stable(item) ===
          stable(
            PUBLIC_SSR_EMPTY_DATA[key as keyof typeof PUBLIC_SSR_EMPTY_DATA]
          ),
      })
    );
  }
  if (value.outcome === "authoritatively-unavailable") {
    return fields(value, {
      observedAt: iso,
      outcome: (item) => item === "authoritatively-unavailable",
      reason: oneOf(["not-published", "not-supported", "source-unavailable"]),
      sourceUpdatedAt: nullable(iso),
    });
  }
  if (value.outcome === "transiently-unavailable") {
    return (
      (key === "nextSchedule" || key === "schedule" || key === "vessels") &&
      fields(value, {
        observedAt: iso,
        outcome: (item) => item === "transiently-unavailable",
        reason: oneOf(["refreshing", "warming"]),
        sourceUpdatedAt: (item) => item === null,
      })
    );
  }
  return (
    value.outcome === "stale-usable" &&
    fields(value, {
      observedAt: iso,
      outcome: (item) => item === "stale-usable",
      sourceUpdatedAt: iso,
      value: (item) => publicPayload(key, item),
    })
  );
};

/** Parses the finite public document schema; loader-only outcomes never cross SSR. */
export const assertPublicSsrSnapshot = (
  input: unknown,
  resolver: PublicSsrTerminalResolver = createStaticPublicSsrTerminalResolver()
): PublicSsrSnapshot => {
  scanForbidden(input);
  if (
    !fields(input, {
      canonicalHost: oneOf(["ferry.fyi", "howmanyboats.today"]),
      canonicalPath: string,
      hostProfile: oneOf(["ferry.fyi", "howmanyboats.today"]),
      indexability: oneOf(["indexable", "noindex"]),
      metadata: (item) =>
        fields(item, {
          canonicalPath: string,
          description: string,
          robots: oneOf(["index,follow", "noindex,follow"]),
          title: string,
        }),
      normalizedUrl: (item) =>
        fields(item, { path: string, query: (query) => map(string)(query) }),
      renderedAt: iso,
      routeId: string,
      routeParams: (params) =>
        fields(
          params,
          {},
          {
            mateSlug: string,
            terminalId: string,
            terminalSlug: string,
            vesselId: string,
          }
        ),
      sources: object,
      version: (version) => version === PUBLIC_SSR_SNAPSHOT_VERSION,
    })
  ) {
    throw new Error("Invalid public SSR snapshot shape");
  }
  const snapshot = input as RecordValue;
  let route;
  try {
    route = getPublicSsrRouteDefinition(snapshot.routeId as PublicSsrRouteId);
  } catch {
    throw new Error("Invalid public SSR snapshot shape");
  }
  if (
    snapshot.canonicalHost !== snapshot.hostProfile ||
    snapshot.canonicalPath !== (snapshot.normalizedUrl as RecordValue).path ||
    snapshot.canonicalPath !==
      (snapshot.metadata as RecordValue).canonicalPath ||
    (snapshot.indexability === "indexable") !==
      ((snapshot.metadata as RecordValue).robots === "index,follow")
  ) {
    throw new Error("Invalid public SSR snapshot coherence");
  }
  if (route.id === "unknown-public-path") {
    const metadata = getNotFoundSeoMetadata();
    if (
      snapshot.canonicalPath !== "/404" ||
      snapshot.indexability !== "noindex" ||
      (snapshot.metadata as RecordValue).canonicalPath !==
        metadata.canonicalPath ||
      (snapshot.metadata as RecordValue).description !== metadata.description ||
      (snapshot.metadata as RecordValue).robots !== metadata.robots ||
      (snapshot.metadata as RecordValue).title !== metadata.title
    ) {
      throw new Error("Invalid public SSR snapshot coherence");
    }
  } else if (snapshot.canonicalHost === "howmanyboats.today") {
    const profile = getSeoProfile(
      snapshot.canonicalHost,
      snapshot.canonicalPath as string
    );
    if (
      (snapshot.metadata as RecordValue).canonicalPath !==
        profile.metadata.canonicalPath ||
      (snapshot.metadata as RecordValue).description !==
        profile.metadata.description ||
      (snapshot.metadata as RecordValue).robots !== profile.metadata.robots ||
      (snapshot.metadata as RecordValue).title !== profile.metadata.title
    ) {
      throw new Error("Invalid public SSR snapshot coherence");
    }
  }
  const sources = snapshot.sources as RecordValue;
  const keys = Object.keys(sources);
  const invalidSource = route.requiredSources.find(
    (key) => !hasOwn(sources, key) || !source(key, sources[key])
  );
  if (
    keys.length !== route.requiredSources.length ||
    invalidSource !== undefined ||
    keys.some(
      (key) => !route.requiredSources.includes(key as PublicSsrSourceKey)
    )
  ) {
    throw new Error(
      invalidSource
        ? `Invalid public SSR snapshot sources: ${invalidSource}`
        : "Invalid public SSR snapshot sources"
    );
  }
  assertPublicSsrRouteCoherence(
    {
      canonicalHost: snapshot.canonicalHost as
        | "ferry.fyi"
        | "howmanyboats.today",
      canonicalPath: snapshot.canonicalPath as string,
      query: (snapshot.normalizedUrl as RecordValue).query as Record<
        string,
        string
      >,
      routeId: snapshot.routeId as PublicSsrRouteId,
      routeParams: snapshot.routeParams as PublicSsrRouteParams,
    },
    resolver
  );
  return input as unknown as PublicSsrSnapshot;
};
