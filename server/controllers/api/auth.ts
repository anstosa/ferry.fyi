import { NextFunction, RequestHandler, Response } from "express";
import { auth } from "express-oauth2-jwt-bearer";

import { isApplicationTokenRevoked } from "~/lib/admin/sessionRevocation";
import { getAuth0IssuerUrls } from "~/lib/auth0Config";

// migration-safe issuer configuration
const jwtValidationOptions = {
  audience: process.env.AUTH0_CLIENT_AUDIENCE as string,
  mcd: { issuers: getAuth0IssuerUrls() },
};
const validateJwt = auth({
  ...jwtValidationOptions,
});
const validateOptionalJwt = auth({
  ...jwtValidationOptions,
  authRequired: false,
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
      response.locals.user = { iat: issuedAtSeconds, sub: subject };
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
