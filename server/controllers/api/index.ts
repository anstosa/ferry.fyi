import { Router } from "express";

import { getWsfStatus } from "~/lib/wsf/api";

import { assignAuthUser, requireAuth } from "./auth";
import { cameraRouter } from "./cameras";
import { debugRouter } from "./debug";
import { scheduleRouter } from "./schedule";
import { terminalRouter } from "./terminals";
import { ticketRouter } from "./tickets";
import { userRouter } from "./user";
import { vesselRouter } from "./vessels";

const apiRouter = Router();

// wrap all routes with wsf status middleware
apiRouter.use((request, response, next) => {
  const defaultJson = response.json;
  const wrapJson: (typeof response)["json"] = (body) => {
    return defaultJson.call(response, {
      wsfStatus: getWsfStatus(),
      body,
    });
  };
  response.json = wrapJson;
  next();
});

apiRouter.use("/cameras", cameraRouter);
apiRouter.use("/vessels", vesselRouter);
apiRouter.use("/terminals", terminalRouter);
apiRouter.use("/schedule", scheduleRouter);
apiRouter.use("/tickets", ticketRouter);
if (process.env.NODE_ENV === "development") {
  apiRouter.use("/debug", debugRouter);
}

apiRouter.use("/user", requireAuth, assignAuthUser, userRouter);

export { apiRouter };
