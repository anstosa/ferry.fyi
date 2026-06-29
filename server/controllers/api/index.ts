import { RequestHandler, Response, Router } from "express";

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

const isWrappedApiBody = (body: unknown): boolean => {
  // envelope guard
  return (
    body !== null &&
    typeof body === "object" &&
    "wsfStatus" in body &&
    "body" in body
  );
};

const wrapApiBody = (body: unknown): unknown => {
  // duplicate envelope guard
  if (isWrappedApiBody(body)) {
    return body;
  }
  return {
    wsfStatus: getWsfStatus(),
    body,
  };
};

export const wrapApiResponse: RequestHandler = (request, response, next) => {
  const defaultSend = response.send;
  const sendJson = (body: unknown): Response => {
    response.type("application/json");
    return defaultSend.call(response, JSON.stringify(wrapApiBody(body)));
  };
  const wrapJson: (typeof response)["json"] = (body) => sendJson(body);
  const wrapSend: (typeof response)["send"] = (body) => {
    // empty status guard
    if (typeof body === "undefined") {
      return defaultSend.call(response, body);
    }
    return sendJson(body);
  };
  response.json = wrapJson;
  response.send = wrapSend;
  next();
};

// wrap all routes with wsf status middleware
apiRouter.use(wrapApiResponse);

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
