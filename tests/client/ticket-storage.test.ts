import { describe, expect, it } from "vitest";

import {
  getReservationAccountCount,
  normalizeTicketList,
  removeStoredTicket,
} from "../../client/views/Tickets/storage";
import type { StoredTicket } from "../../client/views/Tickets/storage";

describe("ticket storage normalization", () => {
  it("backfills a stable added date on existing tickets", () => {
    const existingTicket: StoredTicket = { id: "ticket-1", type: "ticket" };

    const [normalizedTicket] = normalizeTicketList(
      [existingTicket],
      1_754_392_800_000
    );

    expect(normalizedTicket).toEqual({
      addedAt: 1_754_392_800_000,
      id: "ticket-1",
      type: "ticket",
    });
    expect(normalizeTicketList([normalizedTicket], 2)[0]).toBe(
      normalizedTicket
    );
  });

  it("does not add a date to reservation accounts", () => {
    const reservation: StoredTicket = {
      id: "reservation-1",
      type: "reservation",
    };

    expect(normalizeTicketList([reservation], 123)).toEqual([reservation]);
    expect(getReservationAccountCount([reservation])).toBe(1);
  });

  it("removes a refreshed copy of the selected ticket by type and ID", () => {
    const selectedTicket: StoredTicket = {
      id: "ticket-1",
      type: "ticket",
    };
    const refreshedTicket: StoredTicket = {
      id: "ticket-1",
      name: "Refreshed ticket",
      type: "ticket",
    };
    const remainingTicket: StoredTicket = {
      id: "ticket-2",
      type: "ticket",
    };

    expect(
      removeStoredTicket([refreshedTicket, remainingTicket], selectedTicket)
    ).toEqual([remainingTicket]);
  });
});
