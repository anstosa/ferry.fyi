import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const users = vi.hoisted(() => ({
  listFerryUsers: vi.fn(),
  lookupFerryUserSupportProfile: vi.fn(),
}));
const moderation = vi.hoisted(() => ({
  deleteLeaderboardCheckin: vi.fn(),
  getLeaderboardMetrics: vi.fn(),
  getLeaderboardSubjectState: vi.fn(),
  resetLeaderboardProfile: vi.fn(),
  setLeaderboardProfileHidden: vi.fn(),
}));
const operations = vi.hoisted(() => ({
  isAdminOperationName: vi.fn(),
  runAdminOperation: vi.fn(),
}));
const content = vi.hoisted(() => ({
  createAnnouncement: vi.fn(),
  saveSiteSettings: vi.fn(),
}));

vi.mock("~/lib/admin/users", () => users);
vi.mock("~/lib/admin/leaderboardModeration", () => moderation);
vi.mock("~/lib/admin/operations", () => operations);
vi.mock("~/lib/admin/content", () => content);

import { getAdminConfirmationPhrase } from "../../../server/controllers/api/admin/confirmation";
import { adminContentRouter } from "../../../server/controllers/api/admin/content";
import { adminLeaderboardsRouter } from "../../../server/controllers/api/admin/leaderboards";
import { adminUsersRouter } from "../../../server/controllers/api/admin/users";

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/users", adminUsersRouter);
  app.use("/leaderboards", adminLeaderboardsRouter);
  app.use("/content", adminContentRouter);
  return app;
};
const confirmed = (
  action: Parameters<typeof getAdminConfirmationPhrase>[0],
  target: string
) => ({
  action,
  confirmation: getAdminConfirmationPhrase(action, target),
  target,
});

describe("admin support, moderation, and announcement routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    users.lookupFerryUserSupportProfile.mockResolvedValue({
      subject: "auth0|person",
    });
    users.listFerryUsers.mockResolvedValue({
      items: [{ email: "person@example.com", subject: "auth0|person" }],
      page: 0,
      pageSize: 25,
      total: 1,
    });
    moderation.getLeaderboardMetrics.mockResolvedValue({ participants: 2 });
    moderation.deleteLeaderboardCheckin.mockResolvedValue({
      deleted: true,
      id: "abc",
    });
    moderation.setLeaderboardProfileHidden.mockResolvedValue({
      hidden: true,
      subject: "auth0|person",
    });
    moderation.resetLeaderboardProfile.mockResolvedValue({
      deletedCheckins: 2,
      subject: "auth0|person",
    });
    operations.isAdminOperationName.mockReturnValue(true);
    operations.runAdminOperation.mockResolvedValue({ started: true });
    content.createAnnouncement.mockResolvedValue({
      body: "Body",
      id: "id",
      published: false,
      title: "Notice",
    });
    content.saveSiteSettings.mockResolvedValue({
      crawlerPolicy: { aiCrawlers: "allow", disallowPaths: [] },
      leaderboardIndexingEnabled: true,
      leaderboardSharingEnabled: true,
      maintenance: { enabled: false, message: "" },
    });
  });

  it("requires one exact user lookup selector and returns minimized support data", async () => {
    const app = createApp();
    await request(app)
      .get("/users/lookup?email=person@example.com")
      .expect(200, { subject: "auth0|person" });
    expect(users.lookupFerryUserSupportProfile).toHaveBeenCalledWith({
      email: "person@example.com",
      subject: undefined,
    });
    await request(app)
      .get("/users/lookup?email=a@example.com&subject=auth0%7Cperson")
      .expect(400);
  });

  it("lists a bounded page of directory users for the owner console", async () => {
    const app = createApp();
    await request(app)
      .get("/users?page=0&query=person")
      .expect(200, {
        items: [{ email: "person@example.com", subject: "auth0|person" }],
        page: 0,
        pageSize: 25,
        total: 1,
      });
    expect(users.listFerryUsers).toHaveBeenCalledWith({
      page: 0,
      query: "person",
    });
    await request(app).get("/users?page=-1").expect(400);
  });

  it("guards check-in moderation with a target-bound confirmation", async () => {
    const app = createApp();
    const target = "checkin:abc";
    await request(app)
      .delete("/leaderboards/checkins/abc")
      .send(confirmed("delete-checkin", target))
      .expect(200, { deleted: true, id: "abc" });
    expect(moderation.deleteLeaderboardCheckin).toHaveBeenCalledWith("abc");
    await request(app)
      .get("/leaderboards/metrics")
      .expect(200, { participants: 2 });
  });

  it("creates an announcement only after a server-confirmed lifecycle action", async () => {
    const app = createApp();
    await request(app)
      .post("/content/announcements")
      .send({
        ...confirmed("publish-announcement", "announcement:new"),
        body: "Body",
        published: false,
        title: "Notice",
      })
      .expect(201, {
        body: "Body",
        id: "id",
        published: false,
        title: "Notice",
      });
    expect(content.createAnnouncement).toHaveBeenCalledWith({
      body: "Body",
      published: false,
      title: "Notice",
    });
  });

  it("saves site controls together behind one target-bound confirmation", async () => {
    const app = createApp();
    const target = "site:settings";
    const settings = {
      crawlerPolicy: { aiCrawlers: "allow", disallowPaths: [] },
      leaderboardIndexingEnabled: true,
      leaderboardSharingEnabled: false,
      maintenance: { enabled: true, message: "Brief notice" },
    };
    await request(app)
      .put("/content/settings")
      .send({ ...confirmed("save-site-settings", target), ...settings })
      .expect(200);
    expect(content.saveSiteSettings).toHaveBeenCalledWith(settings);
  });
});
