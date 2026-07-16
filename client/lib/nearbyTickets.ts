import { DateTime } from "luxon";
import type { Terminal } from "shared/contracts/terminals";
import type {
  ReservationAccount,
  TicketStorage,
} from "shared/contracts/tickets";
import { getTicketDisplayInfo } from "shared/lib/tickets";

import { getDistance, Point } from "./geo";
import { getRouteGroups, sortRouteGroups } from "./routeGroups";

export type StoredTicket = TicketStorage | ReservationAccount;

export interface NearbyTicketGroup {
  id: string;
  label: string;
  tickets: StoredTicket[];
}

const NEARBY_TERMINAL_DISTANCE_MILES = 0.5;
const RESERVATION_ROUTE_ID = "9";

const getTicketRouteId = (
  ticket: TicketStorage,
  terminal: Terminal
): string | null => {
  const { routeName } = getTicketDisplayInfo({
    description: ticket.description,
    fallbackTitle: "Ticket",
    name: ticket.name,
    plu: ticket.plu || ticket.id,
  });
  const route = Object.values(terminal.routes ?? {}).find((route) => {
    return route.description === routeName;
  });
  const { id: routeId } = route ?? {};
  return routeId ?? null;
};

const isUsableTicket = (ticket: TicketStorage): boolean => {
  if (ticket.status !== "Valid" || !ticket.usesRemaining) {
    return false;
  }
  if (typeof ticket.expirationDate !== "number") {
    return true;
  }
  const expirationBoundary = DateTime.local()
    .set({ hour: 3, millisecond: 0, minute: 0, second: 0 })
    .plus({ day: 1 });
  return DateTime.fromMillis(ticket.expirationDate) >= expirationBoundary;
};

// valid tickets at a terminal, ordered the same way as homepage route groups
export const getNearbyTicketGroups = ({
  favoriteRouteIds,
  location,
  terminal,
  terminals,
  tickets,
}: {
  favoriteRouteIds: string[];
  location: Point | null;
  terminal: Terminal | null;
  terminals: Terminal[];
  tickets: StoredTicket[];
}): NearbyTicketGroup[] => {
  if (
    !location ||
    !terminal ||
    getDistance(location, terminal.location) > NEARBY_TERMINAL_DISTANCE_MILES
  ) {
    return [];
  }

  const ticketsByRoute = new Map<string, StoredTicket[]>();
  tickets.forEach((ticket) => {
    let routeId: string | null = null;
    if (ticket.type === "reservation") {
      routeId = terminal.routes?.[RESERVATION_ROUTE_ID]
        ? RESERVATION_ROUTE_ID
        : null;
    } else if (isUsableTicket(ticket)) {
      routeId = getTicketRouteId(ticket, terminal);
    }
    if (!routeId) {
      return;
    }
    ticketsByRoute.set(routeId, [
      ...(ticketsByRoute.get(routeId) ?? []),
      ticket,
    ]);
  });

  return sortRouteGroups(
    getRouteGroups(terminals).filter((group) => {
      return group.routeIds.some((routeId) => ticketsByRoute.has(routeId));
    }),
    terminal,
    favoriteRouteIds
  ).map((group) => ({
    id: group.id,
    label: group.label,
    tickets: group.routeIds.flatMap(
      (routeId) => ticketsByRoute.get(routeId) ?? []
    ),
  }));
};
