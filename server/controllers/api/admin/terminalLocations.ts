import { Router } from "express";

import {
  terminalLocationService,
  TerminalLocationValidationError,
} from "~/lib/terminalLocations";

import { requireTypedConfirmation } from "./confirmation";

export const adminTerminalLocationsRouter = Router();

// expose locations only behind the parent owner authorization boundary
adminTerminalLocationsRouter.get("/", async (_request, response) => {
  try {
    response.send(await terminalLocationService.list());
  } catch {
    // keep database details out of the owner response
    response.status(503).send({ error: "Terminal locations unavailable" });
  }
});

adminTerminalLocationsRouter.put(
  "/:terminalId",
  requireTypedConfirmation({
    action: "save-terminal-locations",
    // bind confirmation to the route rather than caller metadata
    getTarget: (request) =>
      /^\d{1,20}$/.test(request.params.terminalId)
        ? `terminal:${request.params.terminalId}`
        : undefined,
  }),
  // atomically save both points after authorization and confirmation
  async (request, response) => {
    try {
      const points = { ...request.body };
      delete points.action;
      delete points.target;
      response.send(
        await terminalLocationService.save(request.params.terminalId, points)
      );
    } catch (error) {
      // expose only bounded validation messages and generic storage failures
      if (error instanceof TerminalLocationValidationError) {
        response.status(400).send({ error: error.message });
      } else {
        response
          .status(503)
          .send({ error: "Terminal locations could not be saved" });
      }
    }
  }
);
