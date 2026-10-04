import type { Route as RouteContract } from "shared/contracts/routes";
import type { TerminalPoint } from "shared/contracts/terminalLocations";
import type { Terminal as TerminalContract } from "shared/contracts/terminals";
import { entries } from "shared/lib/objects";

import logger from "~/lib/logger";
import {
  applyTerminalDocks,
  terminalLocationService,
} from "~/lib/terminalLocations";
import { getWsfStatus } from "~/lib/wsf/api";
import { Route } from "~/models/Route";
import { Terminal } from "~/models/Terminal";

export type PublicTerminalResult =
  | { status: "available"; terminal: TerminalContract }
  | { status: "not-found" | "warming" };

// preserve cached public ferry data when optional dock storage is unavailable
const readPublicDocks = async (): Promise<Record<string, TerminalPoint>> => {
  try {
    return await terminalLocationService.getDocks();
  } catch {
    // log no database diagnostics or owner payloads
    logger.warn("Terminal dock overrides unavailable; using WSF locations");
    return {};
  }
};

// use saved docks for all public map and directory projections
export const getPublicTerminals = async (): Promise<
  Record<string, TerminalContract>
> => {
  const terminals = await Terminal.getAll();
  const docks = await readPublicDocks();
  const results: Record<string, TerminalContract> = {};
  // overlay every terminal and nested mate without changing upstream cache data
  entries(terminals).forEach(([key, terminal]) => {
    results[key] = applyTerminalDocks(terminal.serialize(), docks);
  });
  return results;
};

// keep single-terminal responses consistent with the public directory
export const getPublicTerminal = async (
  terminalId: string
): Promise<PublicTerminalResult> => {
  const terminal = await Terminal.getByIndex(terminalId);
  // resolve overrides only for available upstream terminals
  if (terminal) {
    const docks = await readPublicDocks();
    return {
      status: "available",
      terminal: applyTerminalDocks(terminal.serialize(), docks),
    };
  }
  return getWsfStatus().coreReady
    ? { status: "not-found" }
    : { status: "warming" };
};

export const getPublicRoute = (routeId: string): RouteContract | null => {
  const route = Route.getByIndex(routeId);
  return route ? route.serialize() : null;
};

export const getPublicRoutesForTerminal = (
  terminalId: string
): Record<string, RouteContract> => {
  const routes = Route.getByTerminalId(terminalId);
  const results: Record<string, RouteContract> = {};
  entries(routes).forEach(([key, route]) => {
    results[key] = route.serialize();
  });
  return results;
};
