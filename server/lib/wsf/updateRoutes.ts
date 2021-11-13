import { Route } from "~/models/Route";
import { toWsfDate } from "./date";
import { WSF } from "~/typings/wsf";
import { wsfRequest } from "./api";
import logger from "heroku-logger";

const API_SCHEDULE = "https://www.wsdot.wa.gov/ferries/api/schedule/rest";
const getMatesApi = (date: string = toWsfDate()): string =>
  `${API_SCHEDULE}/terminalsandmates/${date}`;
const getRouteApi = (
  departingId: string,
  arrivingId: string,
  date: string = toWsfDate()
): string =>
  `${API_SCHEDULE}/routedetails/${date}/${departingId}/${arrivingId}`;

export const updateRoutes = async (
  date: string = toWsfDate()
): Promise<void> => {
  logger.info("Started Routes Update");
  const mates = await wsfRequest<WSF.MatesResponse[]>(getMatesApi(date));
  if (!mates) {
    return;
  }
  await Promise.all(
    mates.map(async ({ DepartingTerminalID, ArrivingTerminalID }) => {
      const departingId = String(DepartingTerminalID);
      const arrivingId = String(ArrivingTerminalID);
      const [routeData] =
        (await wsfRequest<WSF.RoutesResponse>(
          getRouteApi(departingId, arrivingId)
        )) ?? [];
      if (!routeData) {
        return null;
      }
      const data = {
        id: String(routeData.RouteID),
        abbreviation: routeData.RouteAbbrev,
        description: routeData.Description,
        crossingTime: Number(routeData.CrossingTime),
      };
      const [route, wasCreated] = Route.getOrCreate(String(routeData.RouteID), {
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
  logger.info(`Updated ${Object.keys(Route.getAll()).length} Routes`);
};
