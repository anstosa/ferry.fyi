import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth0 = vi.hoisted(() => ({
  getAuth0UserInfo: vi.fn(),
  getAuth0UserProfile: vi.fn(),
  linkAuth0UserIdentity: vi.fn(),
  sendAuth0VerificationEmailForProvider: vi.fn(),
}));
const revocation = vi.hoisted(() => ({
  isApplicationTokenRevoked: vi.fn(),
}));

vi.mock("~/lib/auth0Admin", () => auth0);
vi.mock("~/lib/admin/sessionRevocation", () => revocation);
vi.mock("express-oauth2-jwt-bearer", () => ({
  // auth fixture
  auth:
    () =>
    (
      expressRequest: Request & { auth?: { payload: { sub?: string } } },
      response: Response,
      next: NextFunction
    ): void => {
      // token fixture
      if (expressRequest.get("authorization") === "Bearer primary-token") {
        expressRequest.auth = { payload: { sub: "google-oauth2|google-user" } };
        next();
        return;
      }
      response.status(401).send({ error: "Unauthorized" });
    },
}));

import { requireAuth } from "../../server/controllers/api/auth";
import { iosMigrationRouter } from "../../server/controllers/api/iosMigration";

// app fixture
const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/ios-migration", requireAuth, iosMigrationRouter);
  return app;
};

const googleProfile = {
  email: "rider@example.com",
  emailVerified: true,
  identities: [
    {
      connection: "google-oauth2",
      provider: "google-oauth2",
      userId: "google-user",
    },
  ],
  subject: "google-oauth2|google-user",
};

const databaseProfile = {
  email: "rider@example.com",
  emailVerified: true,
  identities: [
    {
      connection: "Username-Password-Authentication",
      provider: "auth0",
      userId: "database-user",
    },
  ],
  subject: "auth0|database-user",
};

describe("iOS account migration API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    revocation.isApplicationTokenRevoked.mockResolvedValue(false);
    auth0.getAuth0UserProfile.mockResolvedValue(googleProfile);
    auth0.getAuth0UserInfo.mockResolvedValue({
      email: "rider@example.com",
      emailVerified: true,
      subject: "auth0|database-user",
    });
    auth0.linkAuth0UserIdentity.mockResolvedValue("linked");
    auth0.sendAuth0VerificationEmailForProvider.mockResolvedValue("sent");
  });

  it("reports eligibility only after Google authentication", async () => {
    const response = await request(createApp())
      .get("/api/ios-migration/status")
      .set("Authorization", "Bearer primary-token")
      .expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      email: "rider@example.com",
      state: "eligible",
    });
  });

  it("reports completion when a database identity is already linked", async () => {
    auth0.getAuth0UserProfile.mockResolvedValue({
      ...googleProfile,
      identities: [...googleProfile.identities, ...databaseProfile.identities],
    });

    const response = await request(createApp())
      .get("/api/ios-migration/status")
      .set("Authorization", "Bearer primary-token")
      .expect(200);

    expect(response.body).toEqual({
      email: "rider@example.com",
      state: "complete",
    });
  });

  it("requests verification for the matching database identity", async () => {
    const response = await request(createApp())
      .post("/api/ios-migration/verification-email")
      .set("Authorization", "Bearer primary-token")
      .send({})
      .expect(200);

    expect(auth0.sendAuth0VerificationEmailForProvider).toHaveBeenCalledWith({
      connection: "Username-Password-Authentication",
      email: "rider@example.com",
      provider: "auth0",
    });
    expect(response.headers.ratelimit).toBeTruthy();
    expect(response.headers["ratelimit-policy"]).toContain("q=5; w=900");
    expect(response.body).toEqual({ status: "sent" });
  });

  it("does not send mail from an unverified primary email", async () => {
    auth0.getAuth0UserProfile.mockResolvedValue({
      ...googleProfile,
      emailVerified: false,
    });

    await request(createApp())
      .post("/api/ios-migration/verification-email")
      .set("Authorization", "Bearer primary-token")
      .send({})
      .expect(409, { error: "google_identity_required" });

    expect(auth0.sendAuth0VerificationEmailForProvider).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "a non-Google primary",
      profile: {
        ...googleProfile,
        identities: [
          {
            connection: "Username-Password-Authentication",
            provider: "auth0",
            userId: "database-user",
          },
        ],
        subject: "auth0|database-user",
      },
    },
    {
      label: "Google linked only as a secondary identity",
      profile: {
        ...googleProfile,
        identities: [
          {
            connection: "Username-Password-Authentication",
            provider: "auth0",
            userId: "database-user",
          },
          ...googleProfile.identities,
        ],
        subject: "auth0|database-user",
      },
    },
  ])("does not send mail for $label", async ({ profile }) => {
    auth0.getAuth0UserProfile.mockResolvedValue(profile);

    await request(createApp())
      .post("/api/ios-migration/verification-email")
      .set("Authorization", "Bearer primary-token")
      .send({})
      .expect(409, { error: "google_identity_required" });

    expect(auth0.sendAuth0VerificationEmailForProvider).not.toHaveBeenCalled();
  });

  it("does not send verification before the database identity exists", async () => {
    auth0.sendAuth0VerificationEmailForProvider.mockResolvedValue(
      "user-not-found"
    );

    await request(createApp())
      .post("/api/ios-migration/verification-email")
      .set("Authorization", "Bearer primary-token")
      .send({})
      .expect(409, { error: "database_identity_required" });
  });

  it("requires a secondary access token instead of accepting identity fields", async () => {
    await request(createApp())
      .post("/api/ios-migration/link")
      .set("Authorization", "Bearer primary-token")
      .send({
        email: "rider@example.com",
        secondarySubject: "auth0|database-user",
      })
      .expect(400);

    expect(auth0.getAuth0UserInfo).not.toHaveBeenCalled();
    expect(auth0.linkAuth0UserIdentity).not.toHaveBeenCalled();
  });

  it("links only a separately authenticated matching database identity", async () => {
    auth0.getAuth0UserProfile
      .mockResolvedValueOnce(googleProfile)
      .mockResolvedValueOnce(databaseProfile);

    const response = await request(createApp())
      .post("/api/ios-migration/link")
      .set("Authorization", "Bearer primary-token")
      .send({ secondaryAccessToken: "secondary-token" })
      .expect(200);

    expect(auth0.getAuth0UserInfo).toHaveBeenCalledWith("secondary-token");
    expect(auth0.linkAuth0UserIdentity).toHaveBeenCalledWith(
      "google-oauth2|google-user",
      databaseProfile.identities[0]
    );
    expect(response.headers.ratelimit).toBeTruthy();
    expect(response.headers["ratelimit-policy"]).toContain("q=10; w=900");
    expect(response.body).toEqual({ status: "linked" });
  });

  it("rejects a secondary identity with a different email", async () => {
    auth0.getAuth0UserInfo.mockResolvedValue({
      email: "attacker@example.com",
      emailVerified: true,
      subject: "auth0|database-user",
    });
    auth0.getAuth0UserProfile
      .mockResolvedValueOnce(googleProfile)
      .mockResolvedValueOnce({
        ...databaseProfile,
        email: "attacker@example.com",
      });

    await request(createApp())
      .post("/api/ios-migration/link")
      .set("Authorization", "Bearer primary-token")
      .send({ secondaryAccessToken: "secondary-token" })
      .expect(409);

    expect(auth0.linkAuth0UserIdentity).not.toHaveBeenCalled();
  });

  it("rejects an unverified secondary identity", async () => {
    auth0.getAuth0UserInfo.mockResolvedValue({
      email: "rider@example.com",
      emailVerified: false,
      subject: "auth0|database-user",
    });

    await request(createApp())
      .post("/api/ios-migration/link")
      .set("Authorization", "Bearer primary-token")
      .send({ secondaryAccessToken: "secondary-token" })
      .expect(409);

    expect(auth0.linkAuth0UserIdentity).not.toHaveBeenCalled();
  });

  it("rejects a database identity from another connection", async () => {
    auth0.getAuth0UserProfile
      .mockResolvedValueOnce(googleProfile)
      .mockResolvedValueOnce({
        ...databaseProfile,
        identities: [
          {
            ...databaseProfile.identities[0],
            connection: "Other-Database",
          },
        ],
      });

    await request(createApp())
      .post("/api/ios-migration/link")
      .set("Authorization", "Bearer primary-token")
      .send({ secondaryAccessToken: "secondary-token" })
      .expect(409);

    expect(auth0.linkAuth0UserIdentity).not.toHaveBeenCalled();
  });
});
