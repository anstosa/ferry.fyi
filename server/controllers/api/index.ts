import { debugRouter } from "./debug";
import { getWsfStatus } from "~/lib/wsf/api";
import { Router } from "express";
import { scheduleRouter } from "./schedule";
import { terminalRouter } from "./terminals";
import { ticketRouter } from "./tickets";
import { userRouter } from "./user";
import { vesselRouter } from "./vessels";
import jwksRsa from "jwks-rsa";
import jwt from "express-jwt";

const apiRouter = Router();

// wrap all routes with wsf status middleware
apiRouter.use((request, response, next) => {
  const defaultJson = response.json;
  const wrapJson: typeof response["json"] = (body) => {
    return defaultJson.call(response, {
      wsfStatus: getWsfStatus(),
      body,
    });
  };
  response.json = wrapJson;
  next();
});

apiRouter.use("/vessels", vesselRouter);
apiRouter.use("/terminals", terminalRouter);
apiRouter.use("/schedule", scheduleRouter);
apiRouter.use("/tickets", ticketRouter);
if (process.env.NODE_ENV === "development") {
  apiRouter.use("/debug", debugRouter);
}

const requireAuth = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
  }),
  audience: process.env.AUTH0_CLIENT_AUDIENCE as string,
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN as string}/`,
  algorithms: ["RS256"],
  resultProperty: "locals.user",
});

apiRouter.use("/user", requireAuth, userRouter);

export { apiRouter };
