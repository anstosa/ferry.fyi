import { CacheableModel } from "./CacheableModel";
import { Route as RouteClass } from "shared/models/routes";
import { Terminal } from "./Terminal";
import { values } from "shared/lib/objects";
import { without } from "shared/lib/arrays";

export class Route extends CacheableModel implements RouteClass {
  static cacheKey = "routes";
  static index = "id";

  id!: string;
  abbreviation!: string;
  date!: string;
  description!: string;
  crossingTime!: number;
  terminalIds!: string[];

  static getMatesByTerminalId(terminalId: string): Terminal[] {
    const terminalIds: string[] = [];
    values(this.getByTerminalId(terminalId)).forEach((route) => {
      terminalIds.splice(0, 0, ...route.terminalIds);
    });
    return without([...new Set(terminalIds)], terminalId)
      .sort()
      .map((terminalId) => Terminal.getByIndex(terminalId)) as Terminal[];
  }

  static getByTerminalId(terminalId: string): Record<string, Route> {
    const routes: Record<string, Route> = {};
    values(this.getAll()).forEach((route) => {
      if (route.terminalIds.includes(terminalId)) {
        routes[route.id] = route;
      }
    });
    return routes;
  }

  static getByDate(targetDate: string): Route[] {
    return values(this.getAll()).filter(({ date }) => date === targetDate);
  }

  serialize(): RouteClass {
    return CacheableModel.serialize({
      id: this.id,
      abbreviation: this.abbreviation,
      date: this.date,
      description: this.description,
      crossingTime: this.crossingTime,
      terminalIds: this.terminalIds,
    });
  }
}
