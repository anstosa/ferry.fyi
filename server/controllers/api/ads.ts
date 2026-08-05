import {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from "express";
import { isObject } from "shared/lib/objects";

import { isTrustedAdMutationOrigin } from "~/lib/adOrigin";
import {
  claimAdExposure,
  issueAdExposure,
  resolveAdClick,
} from "~/services/public/adTracking";

export const adsRouter = Router();

adsRouter.use((_request, response, next) => {
  response.set({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, noarchive, nofollow",
  });
  next();
});

const requireTrustedMutationOrigin = (
  request: Request,
  response: Response,
  next: NextFunction
): void => {
  const origin = request.get("origin");
  if (!origin) {
    next();
    return;
  }
  const requestOrigin = `${request.protocol}://${request.get("host")}`;
  if (!isTrustedAdMutationOrigin(origin, requestOrigin)) {
    response.status(403).send({ error: "origin_not_allowed" });
    return;
  }
  next();
};

adsRouter.post(
  "/exposures",
  requireTrustedMutationOrigin,
  async (request, response) => {
    if (
      !isObject(request.body) ||
      typeof request.body.placementKey !== "string"
    ) {
      response.status(400).send({ error: "invalid_request" });
      return;
    }
    response.send(await issueAdExposure(request.body.placementKey));
  }
);

adsRouter.post(
  "/measure",
  requireTrustedMutationOrigin,
  async (request, response) => {
    if (
      !isObject(request.body) ||
      typeof request.body.token !== "string" ||
      !new Set(["opportunity", "served", "viewable"]).has(
        String(request.body.event)
      )
    ) {
      response.status(400).send({ error: "invalid_request" });
      return;
    }
    await claimAdExposure(
      request.body.token,
      request.body.event as "opportunity" | "served" | "viewable"
    );
    response.status(204).send();
  }
);

adsRouter.post(
  "/click",
  requireTrustedMutationOrigin,
  async (request, response) => {
    if (
      !isObject(request.body) ||
      typeof request.body.campaignId !== "string" ||
      typeof request.body.token !== "string"
    ) {
      response.status(400).send({ error: "invalid_request" });
      return;
    }
    const targetUrl = await resolveAdClick({
      campaignId: request.body.campaignId,
      token: request.body.token,
    });
    if (!targetUrl) {
      response.status(404).send({ error: "resource_not_found" });
      return;
    }
    response.send({ targetUrl });
  }
);
