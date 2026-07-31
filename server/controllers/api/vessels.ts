import { Router } from "express";

import { updateVesselStatus } from "~/lib/wsf/updateVessels";
import { getPublicVessel, getPublicVessels } from "~/services/public/vessels";

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
  } catch {
    return response
      .status(502)
      .send({ error: "Unable to refresh vessel data" });
  }
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
