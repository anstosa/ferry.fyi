import { Router } from "express";
import { Vessel as VesselClass } from "shared/contracts/vessels";
import { entries } from "shared/lib/objects";

import { getWsfStatus } from "~/lib/wsf/api";
import { Vessel } from "~/models/Vessel";
import { updateVesselStatus } from "~/lib/wsf/updateVessels";

const vesselRouter = Router();
let vesselRefresh: Promise<void> | null = null;
let vesselSourceUpdatedAt: number | null = null;

vesselRouter.post("/refresh", async (request, response) => {
  if (!vesselRefresh) {
    vesselRefresh = updateVesselStatus()
      .then(() => {
        vesselSourceUpdatedAt = Date.now() / 1000;
      })
      .finally(() => {
        vesselRefresh = null;
      });
  }
  try {
    await vesselRefresh;
    return response.send({ sourceUpdatedAt: vesselSourceUpdatedAt });
  } catch (error) {
    return response.status(502).send({ error: "Unable to refresh vessel data" });
  }
});

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
