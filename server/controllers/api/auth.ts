import { NextFunction, Request, RequestHandler, Response } from "express";
import { auth } from "express-oauth2-jwt-bearer";

import { isApplicationTokenRevoked } from "~/lib/admin/sessionRevocation";

const validateJwt = auth({
  audience: process.env.AUTH0_CLIENT_AUDIENCE as string,
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN as string}/`,
});

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
    const issuedAt = request.auth?.payload.iat;
    if (typeof subject !== "string") {
      response.status(401).send({ error: "Missing authenticated subject" });
      return;
    }
    // `iat` is optional in JWTs. A missing value is treated as pre-watermark,
    // so it is denied once the subject has been force signed out.
    const issuedAtSeconds = typeof issuedAt === "number" ? issuedAt : 0;
    isApplicationTokenRevoked(subject, issuedAtSeconds)
      .then((revoked) => {
        if (revoked) {
          response
            .status(401)
            .send({ error: "Application session has been revoked" });
          return;
        }
        next();
      })
      .catch(next);
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
    response.status(401).send({ error: "Missing authenticated subject" });
    return;
  }
  response.locals.user = { sub: subject };
  next();
};
