export enum Level {
  HIGH = "high",
  INFO = "info",
  LOW = "low",
}

export const SortedLevels = [Level.LOW, Level.INFO, Level.HIGH];

export interface Bulletin {
  bodyHTML: string;
  bodyText: string;
  date: number;
  level: Level;
  routePrefix: string;
  terminalId: string;
  title: string;
  url?: string;
}
