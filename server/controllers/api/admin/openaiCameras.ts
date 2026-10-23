import { Router } from "express";

export const adminOpenaiCamerasRouter = Router();

// inspect only cached private evidence behind the parent owner-admin boundary
adminOpenaiCamerasRouter.get("/", async (_request, response) => {
  const { getOpenaiCameraStatus } = await import("~/lib/openaiCameraRuntime");
  response.send(await getOpenaiCameraStatus());
});
