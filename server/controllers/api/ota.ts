import { Router } from "express";

import { getOtaUpdateManifest } from "~/lib/ota";

const otaRouter = Router();

// serve the Capgo manifest protocol
otaRouter.post("/manifest", async (request, response) => {
  // preserve the updater's top-level response protocol
  return response.json(await getOtaUpdateManifest(request.body));
});

export { otaRouter };
