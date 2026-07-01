import { Route } from "~/models/Route";
import { Terminal } from "~/models/Terminal";
import { Vessel } from "~/models/Vessel";

type IndexedModel<T> = {
  getByIndex?: (id: string) => T | null;
};

interface LogBlockSection {
  heading?: string;
  lines: string[];
}

// normalize log id
const normalizeLogId = (id?: number | string | null): string | null => {
  // missing id guard
  if (id === undefined || id === null || id === "") {
    return null;
  }
  return String(id);
};

// describe terminal
export const formatTerminalName = (id?: number | string | null): string => {
  const terminalId = normalizeLogId(id);
  // missing terminal guard
  if (!terminalId) {
    return "all terminals";
  }
  const terminalModel = Terminal as IndexedModel<Terminal>;
  const terminal = terminalModel.getByIndex?.(terminalId);
  // unknown terminal guard
  if (!terminal) {
    return `terminal ${terminalId}`;
  }
  // abbreviation guard
  if (terminal.abbreviation) {
    return `${terminal.name} (${terminal.abbreviation}, id ${terminalId})`;
  }
  return `${terminal.name} (id ${terminalId})`;
};

// format ascii block
export const formatLogBlock = (
  title: string,
  sections: LogBlockSection[]
): string => {
  const rows = sections.flatMap((section, index) => {
    const lines: string[] = [];
    // section spacer
    if (index > 0) {
      lines.push("|");
    }
    // section heading
    if (section.heading) {
      lines.push(`| ${section.heading}`);
    }
    return lines.concat(section.lines.map((line) => `|   ${line}`));
  });
  return [``, `+-- ${title}`, ...rows, "+--"].join("\n");
};

// describe log list
const formatLogList = <T>(
  items: T[],
  formatter: (item: T) => string
): string[] => {
  // empty list guard
  if (items.length === 0) {
    return ["- none"];
  }
  return items.map((item) => `- ${formatter(item)}`);
};

// describe terminal list
export const formatTerminalList = (ids: Array<number | string>): string[] =>
  formatLogList(ids, formatTerminalName);

// describe route
export const formatRouteName = (id?: number | string | null): string => {
  const routeId = normalizeLogId(id);
  // missing route guard
  if (!routeId) {
    return "all routes";
  }
  const routeModel = Route as IndexedModel<Route>;
  const route = routeModel.getByIndex?.(routeId);
  // unknown route guard
  if (!route) {
    return `route ${routeId}`;
  }
  // description guard
  if (route.description) {
    return `${route.description} (route ${routeId})`;
  }
  // abbreviation guard
  if (route.abbreviation) {
    return `${route.abbreviation} (route ${routeId})`;
  }
  return `route ${routeId}`;
};

// describe route leg
export const formatRouteLegName = (
  departingId?: number | string | null,
  arrivingId?: number | string | null
): string =>
  `${formatTerminalName(departingId)} -> ${formatTerminalName(arrivingId)}`;

// describe schedule target
export const formatScheduleTarget = (
  date: string,
  terminalId?: number | string | null,
  mateId?: number | string | null
): string => {
  // specific leg guard
  if (terminalId && mateId) {
    return `${date} ${formatRouteLegName(terminalId, mateId)}`;
  }
  // departing terminal guard
  if (terminalId) {
    return `${date} departures from ${formatTerminalName(terminalId)}`;
  }
  return `${date} all schedule pairs`;
};

// describe vessel
export const formatVesselName = (id?: number | string | null): string => {
  const vesselId = normalizeLogId(id);
  // missing vessel guard
  if (!vesselId) {
    return "unknown vessel";
  }
  const vesselModel = Vessel as IndexedModel<Vessel>;
  const vessel = vesselModel.getByIndex?.(vesselId);
  // unknown vessel guard
  if (!vessel) {
    return `vessel ${vesselId}`;
  }
  return `${vessel.name} (id ${vesselId})`;
};

// describe route list
export const formatRouteList = (ids: Array<number | string>): string[] =>
  formatLogList(ids, formatRouteName);

// describe vessel list
export const formatVesselList = (ids: Array<number | string>): string[] =>
  formatLogList(ids, formatVesselName);
