import { Router } from "express";

import { Bulletin } from "~/models/Bulletin";

import { createCameraDetectionDebuggerRouter } from "./cameraDetectionDebugger";

const debugRouter = Router();

debugRouter.use(
  "/camera-detection",
  (request, response, next) => {
    // read-only development surface
    if (request.method !== "GET") {
      response.status(404).end();
      return;
    }
    next();
  },
  createCameraDetectionDebuggerRouter()
);

debugRouter.post("/alert", async (request, response) => {
  const data = request.body;
  const [bulletin] = await Bulletin.getOrCreate(
    Bulletin.generateIndex(data),
    data
  );
  return response.send(bulletin.serialize());
});

export { debugRouter };
