import { NextFunction, Request, Response } from "express";

import { getAuth0UserEmail, getAuth0UserInfo } from "~/lib/auth0Admin";

const OWNER_EMAIL = "anstosa@gmail.com";
const accessDenied = { error: "Administrator access required" };
const isOwnerEmail = (email: string | undefined): boolean =>
  email?.toLocaleLowerCase("en-US") === OWNER_EMAIL;

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

  const accessToken = request.auth?.token;
  if (typeof accessToken === "string") {
    try {
      const identity = await getAuth0UserInfo(accessToken);
      if (identity.subject !== subject || !isOwnerEmail(identity.email)) {
        response.status(403).send(accessDenied);
        return;
      }
      next();
      return;
    } catch {
      // Compatibility fallback for older tokens that cannot call /userinfo.
    }
  }

  try {
    if (!isOwnerEmail(await getAuth0UserEmail(subject))) {
      response.status(403).send(accessDenied);
      return;
    }
  } catch {
    response.status(403).send(accessDenied);
    return;
  }

  next();
};
