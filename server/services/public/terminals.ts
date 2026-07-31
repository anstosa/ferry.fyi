import type { Route as RouteContract } from "shared/contracts/routes";
import type { Terminal as TerminalContract } from "shared/contracts/terminals";
import { entries } from "shared/lib/objects";

import { getWsfStatus } from "~/lib/wsf/api";
import { Route } from "~/models/Route";
import { Terminal } from "~/models/Terminal";

export type PublicTerminalResult =
  | { status: "available"; terminal: TerminalContract }
  | { status: "not-found" | "warming" };

export const getPublicTerminals = async (): Promise<
  Record<string, TerminalContract>
> => {
  const terminals = await Terminal.getAll();
  const results: Record<string, TerminalContract> = {};
  entries(terminals).forEach(([key, terminal]) => {
    results[key] = terminal.serialize();
  });
  return results;
};

export const getPublicTerminal = async (
  terminalId: string
): Promise<PublicTerminalResult> => {
  const terminal = await Terminal.getByIndex(terminalId);
  if (terminal) {
    return { status: "available", terminal: terminal.serialize() };
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
