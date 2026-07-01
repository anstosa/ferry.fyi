import logger from "heroku-logger";
import type { Route as RouteClass } from "shared/contracts/routes";
import wsfCore from "shared/data/wsf-core.json";

import {
  formatLogBlock,
  formatRouteLegName,
  formatRouteList,
} from "~/lib/logging";
import { Route } from "~/models/Route";
import { WSF } from "~/typings/wsf";

import { wsfRequest } from "./api";
import { toWsfDate } from "./date";
import {
  isRemovedTerminalId,
  purgeRemovedTerminalData,
} from "./removedTerminals";

const API_SCHEDULE = "https://www.wsdot.wa.gov/ferries/api/schedule/rest";
const getMatesApi = (date: string = toWsfDate()): string =>
  `${API_SCHEDULE}/terminalsandmates/${date}`;
const getRouteApi = (
  departingId: string,
  arrivingId: string,
  date: string = toWsfDate()
): string =>
  `${API_SCHEDULE}/routedetails/${date}/${departingId}/${arrivingId}`;
const staticRoutes = wsfCore.routes as Record<string, Partial<RouteClass>>;

// merge static route metadata
const getStaticRouteData = (routeId: string): Partial<RouteClass> => {
  return staticRoutes[routeId] ?? {};
};

export const updateRoutes = async (
  date: string = toWsfDate()
): Promise<void> => {
  logger.info(`Started route update for ${date}`);
  const mates = await wsfRequest<WSF.MatesResponse[]>(getMatesApi(date));
  // missing mates guard
  if (!mates) {
    logger.info(`Skipped route update for ${date}; WSF returned no mates`);
    return;
  }
  const updatedRoutes = await Promise.all(
    mates
      // skip retired terminals
      .filter(
        ({ DepartingTerminalID, ArrivingTerminalID }) =>
          ![DepartingTerminalID, ArrivingTerminalID]
            .map(String)
            .some(isRemovedTerminalId)
      )
      .map(async ({ DepartingTerminalID, ArrivingTerminalID }) => {
        const departingId = String(DepartingTerminalID);
        const arrivingId = String(ArrivingTerminalID);
        const [routeData] =
          (await wsfRequest<WSF.RoutesResponse>(
            getRouteApi(departingId, arrivingId)
          )) ?? [];
        // route missing guard
        if (!routeData) {
          logger.info(
            `Skipped route pair ${formatRouteLegName(
              departingId,
              arrivingId
            )}; WSF returned no route data`
          );
          return null;
        }
        const routeId = String(routeData.RouteID);
        const data = {
          ...getStaticRouteData(routeId),
          id: routeId,
          abbreviation: routeData.RouteAbbrev,
          description: routeData.Description,
          crossingTime: Number(routeData.CrossingTime),
        };
        const [route, wasCreated] = Route.getOrCreate(routeId, {
          ...data,
          terminalIds: [departingId, arrivingId],
        });
        // existing route guard
        if (!wasCreated) {
          route.update({
            ...data,
            terminalIds: Array.from(
              new Set([...route.terminalIds, departingId, arrivingId])
            ),
          });
        }
        route.save();
        return route;
      })
  );
  purgeRemovedTerminalData();
  const updatedRouteIds = updatedRoutes
    .filter((route): route is Route => {
      // updated route guard
      return Boolean(route);
    })
    .map((route) => {
      // readable route id
      return route.id;
    });
  logger.info(
    formatLogBlock("Route update complete", [
      {
        heading: "summary",
        lines: [
          `date: ${date}`,
          `routes: ${Object.keys(Route.getAll()).length}`,
        ],
      },
      {
        heading: "updated routes",
        lines: formatRouteList(updatedRouteIds),
      },
    ])
  );
};
