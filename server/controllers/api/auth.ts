import { NextFunction, Request, RequestHandler, Response } from "express";
import { auth } from "express-oauth2-jwt-bearer";

import { isApplicationTokenRevoked } from "~/lib/admin/sessionRevocation";

const validateJwt = auth({
  audience: process.env.AUTH0_CLIENT_AUDIENCE as string,
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN as string}/`,
});
const validateOptionalJwt = auth({
  audience: process.env.AUTH0_CLIENT_AUDIENCE as string,
  authRequired: false,
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN as string}/`,
});

// revocation watermark enforcement
const applyTokenRevocation = (
  subject: string,
  issuedAt: unknown,
  response: Response,
  next: NextFunction
): void => {
  const issuedAtSeconds = typeof issuedAt === "number" ? issuedAt : 0;
  isApplicationTokenRevoked(subject, issuedAtSeconds)
    .then((revoked) => {
      if (revoked) {
        response.status(401).send({ error: "unauthorized" });
        return;
      }
      response.locals.user = { sub: subject };
      next();
    })
    .catch(next);
};

/**
 * Validates Auth0 JWTs and then applies the app's bounded revocation
 * watermark. Every authenticated API route uses this single middleware.
 */
export const requireAuth: RequestHandler = (request, response, next): void => {
  validateJwt(request, response, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }
    const subject = request.auth?.payload.sub;
    // required subject guard
    if (typeof subject !== "string") {
      response.status(401).send({ error: "unauthorized" });
      return;
    }
    // `iat` is optional in JWTs. A missing value is treated as pre-watermark,
    // so it is denied once the subject has been force signed out.
    applyTokenRevocation(subject, request.auth?.payload.iat, response, next);
  });
};

/** optional bearer authentication */
export const assignOptionalAuthUser: RequestHandler = (
  request,
  response,
  next
): void => {
  if (!request.get("authorization")) {
    next();
    return;
  }
  validateOptionalJwt(request, response, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }
    const subject = request.auth?.payload.sub;
    // optional subject guard
    if (typeof subject !== "string") {
      next();
      return;
    }
    applyTokenRevocation(subject, request.auth?.payload.iat, response, next);
  });
};

export const assignAuthUser = (
  request: Request,
  response: Response,
  next: NextFunction
): void => {
  const subject = request.auth?.payload.sub;
  // auth subject guard
  if (!subject) {
    response.status(401).send({ error: "unauthorized" });
    return;
  }
  response.locals.user = { sub: subject };
  next();
};
