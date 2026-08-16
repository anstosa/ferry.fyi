import { NextFunction, Request, Response } from "express";

import { getAuth0UserEmail, getAuth0UserInfo } from "~/lib/auth0Admin";

const OWNER_EMAIL = "anstosa@gmail.com";
const accessDenied = { error: "Administrator access required" };
// unavailable owner identity response
const identityUnavailable = {
  error: "Administrator identity verification unavailable",
};
const OWNER_VERIFICATION_TTL_MS = 5 * 60 * 1000;
const OWNER_VERIFICATION_ATTEMPTS = 2;
const verifiedOwnerSubjects = new Map<string, number>();
const isOwnerEmail = (email: string | undefined): boolean =>
  email?.toLocaleLowerCase("en-US") === OWNER_EMAIL;

// clear cached owner verification
export const clearOwnerAdminVerificationCache = (): void => {
  verifiedOwnerSubjects.clear();
};

// check one cached owner subject
const isCachedOwnerSubject = (subject: string): boolean => {
  const expiresAt = verifiedOwnerSubjects.get(subject) ?? 0;
  // expired cache guard
  if (expiresAt <= Date.now()) {
    verifiedOwnerSubjects.delete(subject);
    return false;
  }
  return true;
};

// cache one verified owner subject
const cacheOwnerSubject = (subject: string): void => {
  verifiedOwnerSubjects.set(subject, Date.now() + OWNER_VERIFICATION_TTL_MS);
};

// verify owner identity with one transient retry
const verifyOwnerUserInfo = async (
  accessToken: string,
  subject: string
): Promise<boolean> => {
  // bounded verification pass
  for (let attempt = 0; attempt < OWNER_VERIFICATION_ATTEMPTS; attempt += 1) {
    try {
      const identity = await getAuth0UserInfo(accessToken);
      return identity.subject === subject && isOwnerEmail(identity.email);
    } catch {
      // final attempt guard
      if (attempt === OWNER_VERIFICATION_ATTEMPTS - 1) {
        throw new Error("Auth0 user info verification unavailable");
      }
    }
  }
  return false;
};

/**
 * Verifies the authenticated Auth0 subject belongs to Ferry FYI's single owner.
 * Successful verification is briefly cached after JWT validation so transient
 * Auth0 profile failures cannot interrupt consecutive admin mutations.
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

  // cached owner branch
  if (isCachedOwnerSubject(subject)) {
    next();
    return;
  }

  const accessToken = request.auth?.token;
  if (typeof accessToken === "string") {
    try {
      if (!(await verifyOwnerUserInfo(accessToken, subject))) {
        response.status(403).send(accessDenied);
        return;
      }
      cacheOwnerSubject(subject);
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
    cacheOwnerSubject(subject);
  } catch {
    response.status(503).send(identityUnavailable);
    return;
  }

  next();
};
