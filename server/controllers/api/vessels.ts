import { entries } from "shared/lib/objects";
import { Router } from "express";
import { Vessel } from "~/models/Vessel";
import { Vessel as VesselClass } from "shared/contracts/vessels";

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
  if (!vessel) {
    return response.status(404).send();
  }
  return response.send(vessel.serialize());
});

export { vesselRouter };
