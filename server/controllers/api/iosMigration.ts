import { Router } from "express";
import { MINUTE, rateLimit } from "express-rate-limit";
import {
  AUTH0_DATABASE_CONNECTION,
  AUTH0_GOOGLE_CONNECTION,
  type IosMigrationLinkResponse,
  type IosMigrationStatus,
  type IosMigrationVerificationEmailResponse,
  isIosMigrationLinkRequest,
} from "shared/contracts/iosMigration";

import {
  type Auth0UserProfile,
  type Auth0UserProviderIdentity,
  getAuth0UserInfo,
  getAuth0UserProfile,
  linkAuth0UserIdentity,
  sendAuth0VerificationEmailForProvider,
} from "~/lib/auth0Admin";

const AUTH0_DATABASE_PROVIDER = "auth0";

// verification email abuse limit
const verificationEmailRateLimiter = rateLimit({
  identifier: "ios-migration-verification-email",
  legacyHeaders: false,
  limit: 5,
  standardHeaders: "draft-8",
  windowMs: 15 * MINUTE,
});
// identity link abuse limit
const linkRateLimiter = rateLimit({
  identifier: "ios-migration-link",
  legacyHeaders: false,
  limit: 10,
  standardHeaders: "draft-8",
  windowMs: 15 * MINUTE,
});

class IosMigrationError extends Error {
  status: number;

  // migration error
  constructor(status: number, message: string) {
    super(message);
    this.name = "IosMigrationError";
    this.status = status;
  }
}

// normalized email
const normalizeEmail = (value: string | undefined): string | undefined => {
  const normalized = value?.trim().toLocaleLowerCase("en-US");
  return normalized || undefined;
};

// provider identity lookup
const findIdentity = (
  profile: Auth0UserProfile,
  provider: string,
  connection?: string
): Auth0UserProviderIdentity | undefined =>
  profile.identities.find(
    (identity) =>
      identity.provider === provider &&
      (!connection || identity.connection === connection)
  );

// primary identity guard
const hasPrimaryIdentity = (
  profile: Auth0UserProfile,
  provider: string
): boolean => {
  const identity = findIdentity(profile, provider);
  return Boolean(
    identity && `${provider}|${identity.userId}` === profile.subject
  );
};

// database identity lookup
const findDatabaseIdentity = (
  profile: Auth0UserProfile
): Auth0UserProviderIdentity | undefined =>
  findIdentity(profile, AUTH0_DATABASE_PROVIDER, AUTH0_DATABASE_CONNECTION);

// google profile guard
const isVerifiedGoogleProfile = (profile: Auth0UserProfile): boolean =>
  profile.subject.startsWith(`${AUTH0_GOOGLE_CONNECTION}|`) &&
  profile.emailVerified &&
  Boolean(normalizeEmail(profile.email)) &&
  hasPrimaryIdentity(profile, AUTH0_GOOGLE_CONNECTION);

// status projection
const getMigrationStatus = (profile: Auth0UserProfile): IosMigrationStatus => {
  const email = normalizeEmail(profile.email);
  // eligibility guard
  if (!isVerifiedGoogleProfile(profile) || !email) {
    return { state: "unsupported" };
  }
  return {
    email,
    state: findDatabaseIdentity(profile) ? "complete" : "eligible",
  };
};

// secondary identity verifier
const verifySecondaryIdentity = async (
  accessToken: string,
  primary: Auth0UserProfile
): Promise<Auth0UserProviderIdentity> => {
  const tokenProfile = await getAuth0UserInfo(accessToken);
  // token subject guard
  if (!tokenProfile.subject.startsWith(`${AUTH0_DATABASE_PROVIDER}|`)) {
    throw new IosMigrationError(409, "database_identity_required");
  }
  // token verification guard
  if (!tokenProfile.emailVerified) {
    throw new IosMigrationError(409, "email_verification_required");
  }
  const secondary = await getAuth0UserProfile(tokenProfile.subject);
  const secondaryIdentity = findDatabaseIdentity(secondary);
  const primaryEmail = normalizeEmail(primary.email);
  const tokenEmail = normalizeEmail(tokenProfile.email);
  const secondaryEmail = normalizeEmail(secondary.email);
  // profile verification guard
  if (
    !secondaryIdentity ||
    `${AUTH0_DATABASE_PROVIDER}|${secondaryIdentity.userId}` !==
      secondary.subject ||
    !secondary.emailVerified ||
    !primaryEmail ||
    tokenEmail !== primaryEmail ||
    secondaryEmail !== primaryEmail
  ) {
    throw new IosMigrationError(409, "identity_mismatch");
  }
  return secondaryIdentity;
};

export const iosMigrationRouter = Router();

// disable migration response caching
iosMigrationRouter.use((_request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});

// report migration eligibility
iosMigrationRouter.get("/status", async (_request, response, next) => {
  try {
    const subject = response.locals.user?.sub;
    // auth context guard
    if (typeof subject !== "string") {
      response.status(401).send({ error: "unauthorized" });
      return;
    }
    response.send(getMigrationStatus(await getAuth0UserProfile(subject)));
  } catch (error) {
    next(error);
  }
});

// send secondary identity verification
iosMigrationRouter.post(
  "/verification-email",
  verificationEmailRateLimiter,
  async (_request, response, next) => {
    try {
      const subject = response.locals.user?.sub;
      // auth context guard
      if (typeof subject !== "string") {
        response.status(401).send({ error: "unauthorized" });
        return;
      }
      const primary = await getAuth0UserProfile(subject);
      const email = normalizeEmail(primary.email);
      // primary identity guard
      if (!isVerifiedGoogleProfile(primary) || !email) {
        response.status(409).send({ error: "google_identity_required" });
        return;
      }
      const status = await sendAuth0VerificationEmailForProvider({
        connection: AUTH0_DATABASE_CONNECTION,
        email,
        provider: AUTH0_DATABASE_PROVIDER,
      });
      // secondary identity guard
      if (status === "user-not-found") {
        response.status(409).send({ error: "database_identity_required" });
        return;
      }
      const body: IosMigrationVerificationEmailResponse = { status };
      response.send(body);
    } catch (error) {
      next(error);
    }
  }
);

// verify and link the secondary identity
iosMigrationRouter.post(
  "/link",
  linkRateLimiter,
  async (request, response, next) => {
    try {
      const subject = response.locals.user?.sub;
      // auth context guard
      if (typeof subject !== "string") {
        response.status(401).send({ error: "unauthorized" });
        return;
      }
      // request shape guard
      if (!isIosMigrationLinkRequest(request.body)) {
        response.status(400).send({ error: "invalid_request" });
        return;
      }
      const primary = await getAuth0UserProfile(subject);
      // primary identity guard
      if (!isVerifiedGoogleProfile(primary)) {
        response.status(409).send({ error: "google_identity_required" });
        return;
      }
      const existingIdentity = findDatabaseIdentity(primary);
      // idempotency guard
      if (existingIdentity) {
        const body: IosMigrationLinkResponse = { status: "already-linked" };
        response.send(body);
        return;
      }
      const secondaryIdentity = await verifySecondaryIdentity(
        request.body.secondaryAccessToken,
        primary
      );
      const body: IosMigrationLinkResponse = {
        status: await linkAuth0UserIdentity(subject, secondaryIdentity),
      };
      response.send(body);
    } catch (error) {
      // expected migration guard
      if (error instanceof IosMigrationError) {
        response.status(error.status).send({ error: error.message });
        return;
      }
      next(error);
    }
  }
);
