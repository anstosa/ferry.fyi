import { fetchTicket } from "~/lib/wsf/ticket";
import { Router } from "express";

const ticketRouter = Router();

ticketRouter.get("/:ticketId", async (request, response) => {
  const { ticketId } = request.params;
  const ticket = await fetchTicket(ticketId);
  if (!ticket) {
    return response.status(404).send();
  }
  return response.send(ticket);
});

export { ticketRouter };
