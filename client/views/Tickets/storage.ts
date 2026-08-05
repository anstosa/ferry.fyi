import { atomWithStorage } from "jotai/utils";
import type {
  ReservationAccount,
  TicketStorage,
} from "shared/contracts/tickets";

export type StoredTicket = TicketStorage | ReservationAccount;

// shared ticket storage
export const ticketsAtom = atomWithStorage<StoredTicket[]>("tickets", []);

// collapse duplicate accounts
export const normalizeTicketList = (
  tickets: StoredTicket[],
  addedAt = Date.now()
): StoredTicket[] => {
  let hasReservationAccount = false;

  return tickets.flatMap<StoredTicket>((ticket) => {
    // normal tickets remain
    if (ticket.type !== "reservation") {
      return [
        typeof ticket.addedAt === "number" && Number.isFinite(ticket.addedAt)
          ? ticket
          : { ...ticket, addedAt },
      ];
    }

    // first account remains
    if (!hasReservationAccount) {
      hasReservationAccount = true;
      return [ticket];
    }

    return [];
  });
};

// reservation account count
export const getReservationAccountCount = (tickets: StoredTicket[]): number => {
  return normalizeTicketList(tickets).filter((ticket) => {
    return ticket.type === "reservation";
  }).length;
};

// persisted identity removal
export const removeStoredTicket = (
  tickets: StoredTicket[],
  removedTicket: StoredTicket
): StoredTicket[] =>
  tickets.filter(
    (ticket) =>
      ticket.type !== removedTicket.type || ticket.id !== removedTicket.id
  );
