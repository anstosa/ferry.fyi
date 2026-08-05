import { Router } from "express";

import { requireTypedConfirmation } from "./confirmation";

export const adminTicketsRouter = Router();

// read lookup settings
adminTicketsRouter.get("/", async (_request, response) => {
  const { getTicketLookupSettings } = await import("~/lib/wsf/ticketSettings");
  response.send(await getTicketLookupSettings());
});

// save lookup settings
adminTicketsRouter.put(
  "/settings",
  requireTypedConfirmation({
    action: "save-ticket-lookup-settings",
    getTarget: () => "ticket-lookup:settings",
  }),
  async (request, response) => {
    try {
      const { saveTicketLookupSettings } =
        await import("~/lib/wsf/ticketSettings");
      const settings = await saveTicketLookupSettings(request.body);
      const { resetTicketLookupRuntime } =
        await import("~/lib/wsf/ticketLookup");
      resetTicketLookupRuntime();
      response.send(settings);
    } catch (error) {
      // invalid settings response
      response.status(400).send({
        error:
          error instanceof Error
            ? error.message
            : "Invalid ticket lookup settings",
      });
    }
  }
);
