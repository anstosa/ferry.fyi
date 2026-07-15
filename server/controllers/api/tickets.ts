import { Router } from "express";

import { fetchTicket, TicketLookupUnavailableError } from "~/lib/wsf/ticket";

const ticketRouter = Router();

ticketRouter.get("/:ticketId", async (request, response) => {
  const { ticketId } = request.params;
  try {
    const ticket = await fetchTicket(ticketId);
    // missing ticket guard
    if (!ticket) {
      return response.status(404).send({ error: "ticket_not_found" });
    }
    return response.send({ ...ticket, sourceUpdatedAt: Date.now() / 1000 });
  } catch (error) {
    // upstream unavailable guard
    if (error instanceof TicketLookupUnavailableError) {
      return response.status(503).send({
        error: "ticket_lookup_unavailable",
        message: error.message,
        status: error.status,
      });
    }
    throw error;
  }
});

export { ticketRouter };
