import { getToday } from "./date";
import { Route } from "~/models/Route";
import { values } from "shared/lib/objects";
import { wsfRequest } from "./api";
import logger from "heroku-logger";

const API_SCHEDULE = "https://www.wsdot.wa.gov/ferries/api/schedule/rest";
const getMatesApi = (date: string = getToday()): string =>
  `${API_SCHEDULE}/terminalsandmates/${date}`;
const getRouteApi = (
  departingId: string,
  arrivingId: string,
  date: string = getToday()
): string =>
  `${API_SCHEDULE}/routedetails/${date}/${departingId}/${arrivingId}`;

export const updateRoutes = async (
  date: string = getToday()
): Promise<void> => {
  logger.info("Started Routes Update");
  const mates = await wsfRequest<MatesResponse[]>(getMatesApi(date));
  if (!mates) {
    return;
  }
  const updatedRoutes = await Promise.all(
    mates.map(async ({ DepartingTerminalID, ArrivingTerminalID }) => {
      const departingId = String(DepartingTerminalID);
      const arrivingId = String(ArrivingTerminalID);
      const RouteData = await wsfRequest<RouteResponse>(
        getRouteApi(departingId, arrivingId)
      );
      if (!RouteData) {
        return null;
      }
      const data = {
        id: String(RouteData.RouteID),
        abbreviation: RouteData.RouteAbbrev,
        description: RouteData.Description,
        crossingTime: Number(RouteData.CrossingTime),
      };
      const [route, wasCreated] = Route.getOrCreate(String(RouteData.RouteID), {
        ...data,
        terminalIds: [departingId, arrivingId],
      });
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
  // purge non-updated routes
  const routes = values(Route.getAll());
  routes.forEach((route) => {
    if (!updatedRoutes?.includes(route)) {
      route.purge();
    }
  });
  logger.info("Completed Mates Update");
};
