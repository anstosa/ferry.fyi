import { Router } from "express";

import { updateVesselStatus } from "~/lib/wsf/updateVessels";
import {
  getPublicVessel,
  getPublicVessels,
  getPublicVesselSnapshot,
} from "~/services/public/vessels";

const vesselRouter = Router();
let vesselRefresh: Promise<void> | null = null;

vesselRouter.post("/refresh", async (request, response) => {
  if (!vesselRefresh) {
    vesselRefresh = updateVesselStatus().finally(() => {
      vesselRefresh = null;
    });
  }
  try {
    await vesselRefresh;
    return response.send(await getPublicVesselSnapshot());
  } catch {
    return response
      .status(502)
      .send({ error: "Unable to refresh vessel data" });
  }
});

vesselRouter.get("/snapshot", async (request, response) => {
  return response.send(await getPublicVesselSnapshot());
});

vesselRouter.get("/", async (request, response) => {
  return response.send(await getPublicVessels());
});

vesselRouter.get("/:vesselId", async (request, response) => {
  const { vesselId } = request.params;
  const result = await getPublicVessel(vesselId);
  if (result.status === "available") {
    return response.send(result.vessel);
  }
  if (result.status === "warming") {
    return response.status(503).send({ status: result.status });
  }
  return response.status(404).send();
});

export { vesselRouter };
