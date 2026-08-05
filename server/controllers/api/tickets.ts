import { Router } from "express";

import { TicketLookupUnavailableError } from "~/lib/wsf/ticket";
import { forgetTicket, lookupTicket } from "~/lib/wsf/ticketLookup";

const ticketRouter = Router();

ticketRouter.get("/:ticketId", async (request, response) => {
  const { ticketId } = request.params;
  try {
    const { sourceUpdatedAt, ticket } = await lookupTicket(
      ticketId,
      response.locals.user?.sub
    );
    // missing ticket guard
    if (!ticket) {
      return response.status(404).send({ error: "ticket_not_found" });
    }
    return response.send({ ...ticket, sourceUpdatedAt });
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

ticketRouter.delete("/:ticketId", async (request, response) => {
  const subject = response.locals.user?.sub;
  if (!subject) {
    return response.status(401).send({ error: "unauthorized" });
  }
  await forgetTicket(request.params.ticketId, subject);
  return response.status(204).send();
});

export { ticketRouter };
