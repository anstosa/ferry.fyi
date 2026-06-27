import { Terminal } from "~/models/Terminal";

export interface TideStationTarget {
  stationId: string;
  terminalId: string;
}

const TERMINAL_TIDE_STATIONS: Record<string, string> = {
  "1": "9444900",
  "3": "9447130",
  "4": "9445958",
  "5": "9447659",
  "7": "9447130",
  "8": "9447659",
  "9": "9447130",
  "10": "9449880",
  "11": "9444900",
  "12": "9447659",
  "13": "9449880",
  "14": "9447659",
  "15": "9449880",
  "16": "9446484",
  "17": "9444900",
  "18": "9449880",
  "20": "9447130",
  "21": "9446484",
  "22": "9447130",
};

// resolve tide station
export const getTideStationForTerminal = (terminalId: string): string | null =>
  TERMINAL_TIDE_STATIONS[terminalId] ?? null;

// collect tide targets
export const getTideTargets = (): TideStationTarget[] =>
  Object.values(Terminal.getAll()).flatMap((terminal) => {
    const stationId = getTideStationForTerminal(terminal.id);
    // unmapped terminal guard
    if (!stationId) {
      return [];
    }
    return [{ stationId, terminalId: terminal.id }];
  });

// group targets by station
export const groupTideTargetsByStation = (
  targets: TideStationTarget[]
): Map<string, TideStationTarget[]> => {
  const groups = new Map<string, TideStationTarget[]>();
  // target grouping
  targets.forEach((target) => {
    groups.set(target.stationId, [
      ...(groups.get(target.stationId) ?? []),
      target,
    ]);
  });
  return groups;
};
