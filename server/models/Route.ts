import { Route as RouteClass } from "shared/contracts/routes";
import { without } from "shared/lib/arrays";
import { isNull } from "shared/lib/identity";
import { values } from "shared/lib/objects";
import { compareTerminalsByName } from "shared/lib/terminalSorting";

import { CacheableModel } from "./CacheableModel";
import { Terminal } from "./Terminal";

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
      .map((terminalId) => Terminal.getByIndex(terminalId))
      .filter((terminal): terminal is Terminal => {
        // missing terminal guard
        return !isNull(terminal);
      })
      .sort(compareTerminalsByName);
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
