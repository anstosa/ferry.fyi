import { NextFunction, Request, Response } from "express";
import { auth } from "express-oauth2-jwt-bearer";

export const requireAuth = auth({
  audience: process.env.AUTH0_CLIENT_AUDIENCE as string,
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN as string}/`,
});

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
