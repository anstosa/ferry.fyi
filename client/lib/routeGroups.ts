import { Terminal as TerminalClass } from "shared/contracts/terminals";

export interface RouteGroupConfig {
  annualTraffic: number;
  id: string;
  label: string;
  routeIds: string[];
  terminalColumns?: 2 | 3;
  terminalIds?: string[];
}

export interface RouteGroup extends RouteGroupConfig {
  terminals: TerminalClass[];
}

// 2025 total riders order
export const ROUTE_GROUPS: RouteGroupConfig[] = [
  {
    annualTraffic: 5_217_546,
    id: "bainbridge-island",
    label: "Bainbridge Island",
    routeIds: ["5"],
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
  },
  {
    annualTraffic: 960_584,
    id: "point-defiance",
    label: "Point Defiance",
    routeIds: ["1"],
  },
  {
    annualTraffic: 637_688,
    id: "west-seattle",
    label: "West Seattle",
    routeIds: ["13"],
  },
];

// build terminal lookup
const getTerminalsById = (
  terminals: TerminalClass[]
): Record<string, TerminalClass> =>
  Object.fromEntries(terminals.map((terminal) => [terminal.id, terminal]));

// collect terminal ids
const getGroupTerminalIds = (
  terminals: TerminalClass[],
  config: RouteGroupConfig
): string[] => {
  // explicit order
  if (config.terminalIds) {
    return config.terminalIds;
  }
  const terminalIds: string[] = [];
  // terminal rows
  terminals.forEach((terminal) => {
    // route ids
    config.routeIds.forEach((routeId) => {
      const route = terminal.routes?.[routeId];
      // missing route guard
      if (!route) {
        return;
      }
      route.terminalIds.forEach((terminalId) => {
        // duplicate terminal guard
        if (terminalIds.includes(terminalId)) {
          return;
        }
        terminalIds.push(terminalId);
      });
    });
  });
  return terminalIds;
};

// collect route groups
export const getRouteGroups = (terminals: TerminalClass[]): RouteGroup[] => {
  const terminalsById = getTerminalsById(terminals);
  return ROUTE_GROUPS.map((config) => ({
    ...config,
    terminals: getGroupTerminalIds(terminals, config)
      .map((terminalId) => terminalsById[terminalId])
      .filter((terminal): terminal is TerminalClass => Boolean(terminal)),
  })).filter((group) => group.terminals.length > 0);
};

// route has closest terminal
export const hasClosestTerminal = (
  group: RouteGroup,
  closestTerminal: TerminalClass | null
): boolean =>
  Boolean(
    closestTerminal &&
    group.terminals.some((terminal) => terminal.id === closestTerminal.id)
  );

export const hasFavoriteRoute = (
  group: RouteGroup,
  favoriteRouteIds: string[]
): boolean =>
  group.routeIds.some((routeId) => favoriteRouteIds.includes(routeId));

// sort route groups
export const sortRouteGroups = (
  groups: RouteGroup[],
  closestTerminal: TerminalClass | null,
  favoriteRouteIds: string[] = []
): RouteGroup[] => {
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
