import { NextFunction, Request, Response } from "express";

import { getAuth0UserEmail } from "~/lib/auth0Admin";

const OWNER_EMAIL = "anstosa@gmail.com";
const accessDenied = { error: "Administrator access required" };

/**
 * Verifies the authenticated Auth0 subject belongs to Ferry FYI's single owner.
 * Auth0 lookup failures are deliberately indistinguishable from a non-owner.
 */
export const requireOwnerAdmin = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  const subject = request.auth?.payload.sub;
  if (typeof subject !== "string") {
    response.status(401).send({ error: "Missing authenticated subject" });
    return;
  }

  try {
    const email = await getAuth0UserEmail(subject);
    if (email?.toLocaleLowerCase("en-US") !== OWNER_EMAIL) {
      response.status(403).send(accessDenied);
      return;
    }
  } catch {
    response.status(403).send(accessDenied);
    return;
  }

  next();
};
