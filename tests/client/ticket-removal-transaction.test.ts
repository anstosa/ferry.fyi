import { describe, expect, it, vi } from "vitest";

import { commitTicketRemoval } from "../../client/views/Tickets/deletion";
import { removeStoredTicket } from "../../client/views/Tickets/storage";
import type { TicketStorage } from "../../shared/contracts/tickets";

const deletedTicket: TicketStorage = {
  id: "ticket-1",
  type: "ticket",
};
const remainingTicket: TicketStorage = {
  id: "ticket-2",
  type: "ticket",
};

describe("ticket removal transaction", () => {
  // verify metadata-first success
  it("preserves local state and the overlay until metadata cleanup resolves", async () => {
    let finishUpdate: (() => void) | undefined;
    let tickets = [deletedTicket, remainingTicket];
    let expanded: TicketStorage | null = deletedTicket;
    const updateUser = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishUpdate = resolve;
        })
    );
    // remove local state
    const removeLocal = vi.fn(() => {
      tickets = removeStoredTicket(tickets, deletedTicket);
    });
    // close selected overlay
    const closeOverlay = vi.fn(() => {
      expanded = null;
      return Promise.resolve();
    });

    const removal = commitTicketRemoval({
      closeOverlay,
      deleted: deletedTicket,
      removeLocal,
      savedTickets: ["ticket-1", "ticket-2"],
      updateUser,
    });
    await Promise.resolve();

    expect(updateUser).toHaveBeenCalledWith({
      app_metadata: { tickets: ["ticket-2"] },
    });
    expect(tickets).toEqual([deletedTicket, remainingTicket]);
    expect(expanded).toBe(deletedTicket);
    expect(removeLocal).not.toHaveBeenCalled();
    expect(closeOverlay).not.toHaveBeenCalled();

    finishUpdate?.();
    await removal;

    expect(tickets).toEqual([remainingTicket]);
    expect(expanded).toBeNull();
  });

  // verify metadata failure rollback
  it("preserves local state and the overlay when metadata cleanup rejects", async () => {
    const failure = new Error("metadata update failed");
    const removeLocal = vi.fn();
    const closeOverlay = vi.fn(() => Promise.resolve());

    await expect(
      commitTicketRemoval({
        closeOverlay,
        deleted: deletedTicket,
        removeLocal,
        savedTickets: ["ticket-1"],
        updateUser: vi.fn(() => Promise.reject(failure)),
      })
    ).rejects.toBe(failure);

    expect(removeLocal).not.toHaveBeenCalled();
    expect(closeOverlay).not.toHaveBeenCalled();
  });
});
