import type { Terminal } from "shared/contracts/terminals";

/** route subviews in their shared visual navigation order */
export const ROUTE_VIEW_ORDER = [
  "schedule",
  "navigation",
  "cameras",
  "terminal",
  "map",
  "fare",
  "alerts",
  "subscribe",
] as const;

export type RouteView = (typeof ROUTE_VIEW_ORDER)[number];

export type GetPath = (input?: {
  view?: RouteView;
  terminal?: Terminal;
  mate?: Terminal;
}) => string;
