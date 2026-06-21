import { Router } from "express";
import { Vessel as VesselClass } from "shared/contracts/vessels";
import { entries } from "shared/lib/objects";

import { getWsfStatus } from "~/lib/wsf/api";
import { Vessel } from "~/models/Vessel";

const vesselRouter = Router();

vesselRouter.get("/", async (request, response) => {
  const vessels = await Vessel.getAll();
  const results: Record<string, VesselClass> = {};
  entries(vessels).forEach(([key, vessel]) => {
    results[key] = vessel.serialize();
  });
  return response.send(results);
});

vesselRouter.get("/:vesselId", async (request, response) => {
  const { vesselId } = request.params;
  const vessel = await Vessel.getByIndex(vesselId);
  // vessel found guard
  if (vessel) {
    return response.send(vessel.serialize());
  }
  // warming guard
  if (!getWsfStatus().coreReady) {
    return response.status(503).send({ status: "warming" });
  }
  return response.status(404).send();
});

export { vesselRouter };
