import { LocalNotifications } from "@capacitor/local-notifications";
import { useAtomValue } from "jotai";
import { FunctionComponent, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { isNativeMobileApp } from "~/lib/device";
import { useFavoriteRoutes } from "~/lib/favoriteRoutes";
import { useGeo } from "~/lib/geo";
import { getNearbyTicketGroups } from "~/lib/nearbyTickets";
import { useTerminals } from "~/lib/terminals";
import { normalizeTicketList, ticketsAtom } from "~/views/Tickets/storage";

const NOTIFICATION_ID = 901;

// notify native users when an eligible ticket is ready at a nearby terminal
export const NearbyTicketNotifications: FunctionComponent = () => {
  const navigate = useNavigate();
  const [location] = useGeo();
  const { closestTerminal, terminals } = useTerminals();
  const [favoriteRouteIds] = useFavoriteRoutes();
  const tickets = normalizeTicketList(useAtomValue(ticketsAtom));
  const sentKeys = useRef<Set<string>>(new Set());
  const groups = getNearbyTicketGroups({
    favoriteRouteIds,
    location,
    terminal: closestTerminal,
    terminals,
    tickets,
  });
  const eligibleTickets = groups.flatMap((group) => group.tickets);

  useEffect(() => {
    if (!isNativeMobileApp()) {
      return;
    }
    let removeListener: (() => Promise<void>) | undefined;
    LocalNotifications.addListener(
      "localNotificationActionPerformed",
      ({ notification }) => {
        const path = notification.extra?.path;
        if (typeof path === "string") {
          navigate(path);
        }
      }
    ).then((listener) => {
      removeListener = () => listener.remove();
    });
    return () => {
      removeListener?.();
    };
  }, [navigate]);

  useEffect(() => {
    if (
      !isNativeMobileApp() ||
      !closestTerminal ||
      eligibleTickets.length === 0
    ) {
      return;
    }
    const ticketIds = eligibleTickets
      .map((ticket) => ticket.id)
      .sort()
      .join(":");
    const key = `${closestTerminal.id}:${ticketIds}`;
    if (sentKeys.current.has(key)) {
      return;
    }
    const path =
      eligibleTickets.length === 1
        ? `/tickets?nearbyTerminal=${closestTerminal.id}&openTicket=${eligibleTickets[0].id}`
        : `/tickets?nearbyTerminal=${closestTerminal.id}`;
    const send = async (): Promise<void> => {
      let permissions = await LocalNotifications.checkPermissions();
      if (permissions.display === "prompt") {
        permissions = await LocalNotifications.requestPermissions();
      }
      if (permissions.display !== "granted") {
        return;
      }
      await LocalNotifications.schedule({
        notifications: [
          {
            body:
              eligibleTickets.length === 1
                ? `Your ticket is ready at ${closestTerminal.name}.`
                : `${eligibleTickets.length} tickets are ready at ${closestTerminal.name}.`,
            extra: { path },
            id: NOTIFICATION_ID,
            title: "Ferry FYI tickets",
          },
        ],
      });
      sentKeys.current.add(key);
    };
    send().catch((error) =>
      console.warn("Unable to notify about tickets", error)
    );
  }, [closestTerminal, eligibleTickets]);

  return null;
};
