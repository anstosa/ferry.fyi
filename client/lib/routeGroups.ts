import { Terminal as TerminalClass } from "shared/contracts/terminals";
import ROUTE_TERMINAL_IDS from "shared/data/route-terminal-ids.json";

export interface RouteGroupConfig {
  annualTraffic: number;
  id: string;
  label: string;
  routeIds: string[];
  terminalColumns?: 2 | 3;
  terminalIds: string[];
}

interface RouteGroupTerminal {
  id: string;
}

export interface RouteGroup<
  T extends RouteGroupTerminal = TerminalClass,
> extends RouteGroupConfig {
  terminals: T[];
}

// 2025 total riders order
const ROUTE_GROUPS: RouteGroupConfig[] = [
  {
    annualTraffic: 5_217_546,
    id: "bainbridge-island",
    label: "Bainbridge Island",
    routeIds: ["5"],
    terminalIds: ROUTE_TERMINAL_IDS["5"].terminalIds,
  },
  {
    annualTraffic: 4_438_712,
    id: "whidbey-island",
    label: "Whidbey Island",
    routeIds: ["7", "8"],
    terminalColumns: 2,
    terminalIds: ["5", "14", "11", "17"],
  },
  {
    annualTraffic: 3_863_436,
    id: "kingston",
    label: "Kingston",
    routeIds: ["6"],
    terminalIds: ROUTE_TERMINAL_IDS["6"].terminalIds,
  },
  {
    annualTraffic: 1_954_626,
    id: "san-juan-islands",
    label: "San Juan Islands",
    routeIds: ["9"],
    terminalColumns: 2,
    terminalIds: ["10", "15", "13", "18", "1"],
  },
  {
    annualTraffic: 1_729_690,
    id: "vashon-island",
    label: "Vashon Island",
    routeIds: ["14", "15"],
    terminalColumns: 3,
    terminalIds: ["9", "22", "20"],
  },
  {
    annualTraffic: 1_306_263,
    id: "bremerton",
    label: "Bremerton",
    routeIds: ["3"],
    terminalIds: ROUTE_TERMINAL_IDS["3"].terminalIds,
  },
  {
    annualTraffic: 960_584,
    id: "point-defiance",
    label: "Point Defiance",
    routeIds: ["1"],
    terminalIds: ROUTE_TERMINAL_IDS["1"].terminalIds,
  },
  {
    annualTraffic: 637_688,
    id: "west-seattle",
    label: "West Seattle",
    routeIds: ["13"],
    terminalIds: ROUTE_TERMINAL_IDS["13"].terminalIds,
  },
];

// build terminal lookup
const getTerminalsById = <T extends RouteGroupTerminal>(
  terminals: T[]
): Record<string, T> =>
  Object.fromEntries(terminals.map((terminal) => [terminal.id, terminal]));

// collect route groups
export const getRouteGroups = <T extends RouteGroupTerminal>(
  terminals: T[]
): RouteGroup<T>[] => {
  const terminalsById = getTerminalsById(terminals);
  return ROUTE_GROUPS.map((config) => ({
    ...config,
    terminals: config.terminalIds
      .map((terminalId) => terminalsById[terminalId])
      .filter((terminal): terminal is T => Boolean(terminal)),
  })).filter((group) => group.terminals.length > 0);
};

// route has closest terminal
export const hasClosestTerminal = <T extends RouteGroupTerminal>(
  group: RouteGroup<T>,
  closestTerminal: RouteGroupTerminal | null
): boolean =>
  Boolean(
    closestTerminal &&
    group.terminals.some((terminal) => terminal.id === closestTerminal.id)
  );

export const hasFavoriteRoute = <T extends RouteGroupTerminal>(
  group: RouteGroup<T>,
  favoriteRouteIds: string[]
): boolean =>
  group.routeIds.some((routeId) => favoriteRouteIds.includes(routeId));

// sort route groups
export const sortRouteGroups = <T extends RouteGroupTerminal>(
  groups: RouteGroup<T>[],
  closestTerminal: RouteGroupTerminal | null,
  favoriteRouteIds: string[] = []
): RouteGroup<T>[] => {
  const sortedGroups = [...groups].sort((left, right) => {
    const leftIsFavorite = hasFavoriteRoute(left, favoriteRouteIds);
    const rightIsFavorite = hasFavoriteRoute(right, favoriteRouteIds);

    if (leftIsFavorite !== rightIsFavorite) {
      return leftIsFavorite ? -1 : 1;
    }

    return right.annualTraffic - left.annualTraffic;
  });
  // closest route guard
  if (!closestTerminal) {
    return sortedGroups;
  }
  const closestIndex = sortedGroups.findIndex((group) =>
    hasClosestTerminal(group, closestTerminal)
  );
  // missing closest guard
  if (closestIndex < 0) {
    return sortedGroups;
  }
  const [closestGroup] = sortedGroups.splice(closestIndex, 1);
  return [closestGroup, ...sortedGroups];
};
