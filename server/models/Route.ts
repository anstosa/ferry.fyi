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
    const route = this.getByTerminalId(terminalId);
    if (!route) {
      return [];
    }
    return without(route.terminalIds, terminalId).map(
      Terminal.getByIndex
    ) as Terminal[];
  }

  static getByTerminalId(terminalId: string): Route | null {
    return (
      values(this.getAll()).find(({ terminalIds }) =>
        terminalIds.includes(terminalId)
      ) ?? null
    );
  }

  static getByDate(targetDate: string): Route[] {
    return values(this.getAll()).filter(({ date }) => date === targetDate);
  }

  serialize = (): RouteClass => ({
    id: this.id,
    abbreviation: this.abbreviation,
    date: this.date,
    description: this.description,
    crossingTime: this.crossingTime,
    terminalIds: this.terminalId,
  });
}
