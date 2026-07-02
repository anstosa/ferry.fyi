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
  tickets: StoredTicket[]
): StoredTicket[] => {
  let hasReservationAccount = false;

  return tickets.filter((ticket) => {
    // normal tickets remain
    if (ticket.type !== "reservation") {
      return true;
    }

    // first account remains
    if (!hasReservationAccount) {
      hasReservationAccount = true;
      return true;
    }

    return false;
  });
};

// reservation account count
export const getReservationAccountCount = (tickets: StoredTicket[]): number => {
  return normalizeTicketList(tickets).filter((ticket) => {
    return ticket.type === "reservation";
  }).length;
};
