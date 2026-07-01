import logger from "heroku-logger";
import { DateTime } from "luxon";
import { Op } from "sequelize";
import { values } from "shared/lib/objects";

import { formatLogBlock, formatRouteList } from "~/lib/logging";
import { NormalRouteVessel } from "~/models/NormalRouteVessel";
import { Route } from "~/models/Route";
import { Vessel } from "~/models/Vessel";
import { WSF } from "~/typings/wsf";

import { wsfRequest } from "./api";
import { toWsfDate } from "./date";

const API_SCHEDULE = "https://www.wsdot.wa.gov/ferries/api/schedule/rest";
const NORMAL_SAMPLE_DAYS = 28;
const NORMAL_MIN_DAY_RATIO = 0.75;
const WSF_REQUEST_CONCURRENCY = 5;

// run bounded async work
const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    // claim pending items
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

interface RoutePair {
  arrivingId: string;
  departingId: string;
  routeId: string;
}

export interface VesselObservation {
  date: string;
  position: number | null;
  routeId: string;
  vesselId: string;
  vesselName: string;
}

export interface NormalRouteVesselAssignment {
  calculatedAt: number;
  daysObserved: number;
  inferenceNotes: string;
  isNormal: boolean;
  observedDates: string[];
  positions: number[];
  routeId: string;
  sailingsObserved: number;
  sampleDays: number;
  sampleEndDate: string;
  sampleStartDate: string;
  vesselId: string;
  vesselName: string;
}

// build mates api url
const getMatesApi = (date: string): string =>
  `${API_SCHEDULE}/terminalsandmates/${date}`;

// build route api url
const getRouteApi = (
  departingId: string,
  arrivingId: string,
  date: string
): string =>
  `${API_SCHEDULE}/routedetails/${date}/${departingId}/${arrivingId}`;

// build schedule api url
const getScheduleApi = (
  departingId: string,
  arrivingId: string,
  date: string
): string => `${API_SCHEDULE}/schedule/${date}/${departingId}/${arrivingId}`;

// add calendar days
const getSampleDate = (startDate: DateTime, offsetDays: number): string =>
  toWsfDate(startDate.plus({ days: offsetDays }));

// describe inference result
const getInferenceNotes = (
  isNormal: boolean,
  daysObserved: number,
  sampleDays: number
): string => {
  const requiredDays = Math.ceil(sampleDays * NORMAL_MIN_DAY_RATIO);
  // normal vessel guard
  if (isNormal) {
    return `Observed on ${daysObserved}/${sampleDays} sampled days; treated as normal because threshold is ${requiredDays} days.`;
  }
  return `Observed on ${daysObserved}/${sampleDays} sampled days; retained as non-normal observed assignment because threshold is ${requiredDays} days.`;
};

// build persisted assignments
export const calculateNormalRouteVesselAssignments = (
  routeId: string,
  observations: VesselObservation[],
  sampleDates: string[],
  calculatedAt: number
): NormalRouteVesselAssignment[] => {
  const assignments = new Map<string, NormalRouteVesselAssignment>();
  const sampleStartDate = sampleDates[0];
  const sampleEndDate = sampleDates[sampleDates.length - 1];
  const sampleDays = sampleDates.length;
  // collect vessel observations
  observations.forEach(({ date, position, vesselId, vesselName }) => {
    const existing = assignments.get(vesselId);
    const observedDates = new Set(existing?.observedDates ?? []);
    const positions = new Set(existing?.positions ?? []);
    observedDates.add(date);
    // known position guard
    if (position) {
      positions.add(position);
    }
    const daysObserved = observedDates.size;
    const isNormal =
      daysObserved >= Math.ceil(sampleDays * NORMAL_MIN_DAY_RATIO);
    assignments.set(vesselId, {
      calculatedAt,
      daysObserved,
      inferenceNotes: getInferenceNotes(isNormal, daysObserved, sampleDays),
      isNormal,
      observedDates: Array.from(observedDates).sort(),
      positions: Array.from(positions).sort((left, right) => left - right),
      routeId,
      sailingsObserved: (existing?.sailingsObserved ?? 0) + 1,
      sampleDays,
      sampleEndDate,
      sampleStartDate,
      vesselId,
      vesselName,
    });
  });
  return Array.from(assignments.values()).sort((left, right) => {
    // stable vessel order
    return left.vesselName.localeCompare(right.vesselName);
  });
};

// discover one representative pair per route
const getRoutePairs = async (date: string): Promise<RoutePair[]> => {
  const mates = await wsfRequest<WSF.MatesResponse[]>(getMatesApi(date));
  // missing mates guard
  if (!mates) {
    return [];
  }
  const routePairs = new Map<string, RoutePair>();
  const routePairResults = await mapWithConcurrency(
    mates,
    WSF_REQUEST_CONCURRENCY,
    async ({ DepartingTerminalID, ArrivingTerminalID }) => {
      const departingId = String(DepartingTerminalID);
      const arrivingId = String(ArrivingTerminalID);
      const [routeData] =
        (await wsfRequest<WSF.RoutesResponse>(
          getRouteApi(departingId, arrivingId, date)
        )) ?? [];
      // missing route guard
      if (!routeData) {
        return null;
      }
      return {
        arrivingId,
        departingId,
        routeId: String(routeData.RouteID),
      };
    }
  );
  // dedupe route pairs
  routePairResults.forEach((routePair) => {
    // missing pair guard
    if (!routePair) {
      return;
    }
    // representative pair guard
    if (!routePairs.has(routePair.routeId)) {
      routePairs.set(routePair.routeId, routePair);
    }
  });
  return Array.from(routePairs.values()).sort((left, right) => {
    // stable route order
    return Number(left.routeId) - Number(right.routeId);
  });
};

// collect schedule observations
const getRouteObservations = async (
  routePair: RoutePair,
  sampleDates: string[]
): Promise<VesselObservation[]> => {
  const observationsByDate = await mapWithConcurrency(
    sampleDates,
    WSF_REQUEST_CONCURRENCY,
    async (date) => {
      const observations: VesselObservation[] = [];
      const response = await wsfRequest<WSF.ScheduleResponse>(
        getScheduleApi(routePair.departingId, routePair.arrivingId, date)
      );
      // missing schedule guard
      if (!response) {
        return observations;
      }
      const [terminalCombo] = response.TerminalCombos;
      // missing terminal combo guard
      if (!terminalCombo) {
        return observations;
      }
      // collect sailings
      terminalCombo.Times.forEach(
        ({ Routes, VesselID, VesselName, VesselPositionNum }) => {
          // route mismatch guard
          if (!Routes.includes(Number(routePair.routeId))) {
            return;
          }
          // placeholder vessel guard
          if (!VesselID || !VesselName) {
            return;
          }
          observations.push({
            date,
            position: VesselPositionNum ?? null,
            routeId: routePair.routeId,
            vesselId: String(VesselID),
            vesselName: VesselName,
          });
        }
      );
      return observations;
    }
  );
  return observationsByDate.flat();
};

// update route capacity cache
const updateRouteNormalCapacity = (
  routeId: string,
  assignments: NormalRouteVesselAssignment[]
): void => {
  const normalCapacities = assignments
    .filter(({ isNormal }) => {
      // normal vessel guard
      return isNormal;
    })
    .map(({ vesselId }) => {
      // lookup vessel capacity
      return Vessel.getByIndex(vesselId)?.vehicleCapacity;
    })
    .filter((capacity): capacity is number => {
      // known capacity guard
      return Boolean(capacity);
    });
  const route = Route.getByIndex(routeId);
  // missing route guard
  if (!route) {
    return;
  }
  // missing capacity guard
  if (normalCapacities.length === 0) {
    route.update({
      normalVehicleCapacity: undefined,
      normalVehicleMaxCapacity: undefined,
    });
    route.save();
    return;
  }
  const maxCapacity = Math.max(...normalCapacities);
  const totalCapacity = normalCapacities.reduce((sum, capacity) => {
    // add vessel capacity
    return sum + capacity;
  }, 0);
  route.update({
    normalVehicleCapacity:
      Math.round((totalCapacity / normalCapacities.length) * 10) / 10,
    normalVehicleMaxCapacity: maxCapacity,
  });
  route.save();
};

// persist route assignments
const persistRouteAssignments = async (
  routeId: string,
  assignments: NormalRouteVesselAssignment[]
): Promise<void> => {
  const vesselIds = assignments.map(({ vesselId }) => vesselId);
  // remove stale assignments
  if (vesselIds.length > 0) {
    await NormalRouteVessel.destroy({
      where: {
        routeId,
        vesselId: { [Op.notIn]: vesselIds },
      },
    });
  } else {
    await NormalRouteVessel.destroy({ where: { routeId } });
  }
  // upsert assignments
  for (const assignment of assignments) {
    const existingAssignment = await NormalRouteVessel.findOne({
      where: {
        routeId: assignment.routeId,
        vesselId: assignment.vesselId,
      },
    });
    // existing assignment guard
    if (existingAssignment) {
      existingAssignment.update(assignment);
      await existingAssignment.save();
      continue;
    }
    await NormalRouteVessel.create(
      assignment as unknown as Parameters<typeof NormalRouteVessel.create>[0]
    );
  }
};

export const updateNormalRouteVessels = async (
  startDate: DateTime = DateTime.local()
): Promise<void> => {
  logger.info("Started normal route vessel inference update");
  const sampleDates = Array.from({ length: NORMAL_SAMPLE_DAYS }, (_, index) => {
    // create sample date
    return getSampleDate(startDate, index);
  });
  const calculatedAt = Math.round(DateTime.local().toSeconds());
  const routePairs = await getRoutePairs(sampleDates[0]);
  const knownRouteIds = new Set(values(Route.getAll()).map(({ id }) => id));
  let normalAssignments = 0;
  let skippedRoutes = 0;
  // process route pairs
  for (const routePair of routePairs) {
    // known route guard
    if (knownRouteIds.size > 0 && !knownRouteIds.has(routePair.routeId)) {
      skippedRoutes += 1;
      continue;
    }
    const observations = await getRouteObservations(routePair, sampleDates);
    const assignments = calculateNormalRouteVesselAssignments(
      routePair.routeId,
      observations,
      sampleDates,
      calculatedAt
    );
    normalAssignments += assignments.filter(({ isNormal }) => isNormal).length;
    updateRouteNormalCapacity(routePair.routeId, assignments);
    await persistRouteAssignments(routePair.routeId, assignments);
  }
  const routeIds = routePairs.map((routePair) => {
    // readable route id
    return routePair.routeId;
  });
  logger.info(
    formatLogBlock("Normal route vessel update complete", [
      {
        heading: "summary",
        lines: [
          `normal assignments: ${normalAssignments}`,
          `routes processed: ${routePairs.length - skippedRoutes}`,
          `routes discovered: ${routePairs.length}`,
        ],
      },
      {
        heading: "routes",
        lines: formatRouteList(routeIds),
      },
    ])
  );
};
