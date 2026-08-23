import { Router } from "express";

import {
  apiErrorHandler,
  apiNotFound,
  createApiCorsMiddleware,
  createApiRateLimitMiddleware,
  denyUntrustedSensitivePreflight,
  wrapApiResponse,
} from "~/lib/httpApiPolicy";

import { adminRouter, preventAdminCaching } from "./admin";
import { adsRouter } from "./ads";
import { assignOptionalAuthUser, requireAuth } from "./auth";
import { cameraRouter } from "./cameras";
import { debugRouter } from "./debug";
import { fareRouter } from "./fares";
import { featureRouter } from "./features";
import { iosMigrationRouter } from "./iosMigration";
import { automaticLeaderboardNativeRouter } from "./leaderboardAutomaticNative";
import { leaderboardRouter } from "./leaderboards";
import { otaRouter } from "./ota";
import { scheduleRouter } from "./schedule";
import { supporterRouter } from "./supporter";
import { terminalRouter } from "./terminals";
import { ticketRouter } from "./tickets";
import { userRouter } from "./user";
import { vesselRouter } from "./vessels";

const apiRouter = Router();

// preserve the external updater response protocol
apiRouter.use(createApiCorsMiddleware());
apiRouter.use("/ota", otaRouter);

// wrap all routes with wsf status middleware
apiRouter.use(wrapApiResponse);
apiRouter.use(denyUntrustedSensitivePreflight);
apiRouter.use(createApiRateLimitMiddleware());

apiRouter.use("/cameras", cameraRouter);
apiRouter.use("/ads", assignOptionalAuthUser, adsRouter);
apiRouter.use("/vessels", vesselRouter);
apiRouter.use("/terminals", terminalRouter);
apiRouter.use("/schedule", scheduleRouter);
apiRouter.use("/fares", fareRouter);
apiRouter.use("/features", featureRouter);
apiRouter.use("/tickets", assignOptionalAuthUser, ticketRouter);
apiRouter.use("/leaderboards", leaderboardRouter);
if (process.env.NODE_ENV === "development") {
  apiRouter.use("/debug", debugRouter);
}

apiRouter.use("/admin", preventAdminCaching, requireAuth, adminRouter);
apiRouter.use("/ios-migration", requireAuth, iosMigrationRouter);
apiRouter.use("/user", requireAuth, userRouter);
apiRouter.use("/supporter", requireAuth, supporterRouter);

apiRouter.use(apiNotFound);
apiRouter.use(apiErrorHandler);

export { wrapApiResponse };
export { apiRouter, automaticLeaderboardNativeRouter };
