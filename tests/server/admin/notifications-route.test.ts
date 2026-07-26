import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth0 = vi.hoisted(() => ({ getAuth0UserEmail: vi.fn() }));
const policy = vi.hoisted(() => ({ setNotificationsPaused: vi.fn() }));
const status = vi.hoisted(() => ({ getNotificationDashboard: vi.fn() }));
const sender = vi.hoisted(() => ({
  previewAdminNotification: vi.fn(),
  sendAdminNotification: vi.fn(),
}));

vi.mock("~/lib/auth0Admin", () => auth0);
vi.mock("~/lib/admin/notificationPolicy", () => policy);
vi.mock("~/lib/admin/notificationStatus", () => status);
vi.mock("~/lib/admin/notificationSend", () => sender);

import { requireOwnerAdmin } from "../../../server/controllers/api/admin/authorization";
import { getAdminConfirmationPhrase } from "../../../server/controllers/api/admin/confirmation";
import { adminNotificationsRouter } from "../../../server/controllers/api/admin/notifications";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(
    (
      request: Request & { auth?: { payload: { sub: string } } },
      _response: Response,
      next: NextFunction
    ) => {
      request.auth = { payload: { sub: "auth0|owner" } };
      next();
    }
  );
  app.use(
    "/api/admin/notifications",
    requireOwnerAdmin,
    adminNotificationsRouter
  );
  return app;
};

const target = "notification-policy:global";

describe("owner notification controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth0.getAuth0UserEmail.mockResolvedValue("anstosa@gmail.com");
    status.getNotificationDashboard.mockResolvedValue({
      inFlight: 1,
      policy: { paused: false },
      queued: 2,
      requestResult: "accepted",
    });
    policy.setNotificationsPaused.mockImplementation(
      async (paused: boolean) => ({ paused })
    );
    sender.previewAdminNotification.mockResolvedValue({ recipientCount: 2 });
    sender.sendAdminNotification.mockResolvedValue({
      acceptedCount: 1,
      delivery: "not-confirmed",
      notSubmittedCount: 1,
      recipientCount: 2,
    });
  });

  it("returns only bounded aggregate state, not messages, recipients, or delivery history", async () => {
    const response = await request(createApp())
      .get("/api/admin/notifications/")
      .expect(200);
    expect(response.body).toEqual({
      inFlight: 1,
      policy: { paused: false },
      queued: 2,
      requestResult: "accepted",
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /recipient|message|deliver|history|audit/i
    );
  });

  it("requires a route-bound typed confirmation before pausing or resuming", async () => {
    await request(createApp())
      .post("/api/admin/notifications/pause")
      .send({})
      .expect(400);
    expect(policy.setNotificationsPaused).not.toHaveBeenCalled();

    await request(createApp())
      .post("/api/admin/notifications/pause")
      .send({
        action: "pause-notifications",
        confirmation: getAdminConfirmationPhrase("pause-notifications", target),
        target,
      })
      .expect(200, { policy: { paused: true } });

    await request(createApp())
      .post("/api/admin/notifications/resume")
      .send({
        action: "resume-notifications",
        confirmation: getAdminConfirmationPhrase(
          "resume-notifications",
          target
        ),
        target,
      })
      .expect(200, { policy: { paused: false } });

    expect(policy.setNotificationsPaused).toHaveBeenNthCalledWith(1, true);
    expect(policy.setNotificationsPaused).toHaveBeenNthCalledWith(2, false);
  });
  it("previews aggregate counts and requires route-bound confirmation before a broadcast send", async () => {
    await request(createApp())
      .post("/api/admin/notifications/broadcast/preview")
      .send({ title: "Notice", body: "Ferry update" })
      .expect(200, { recipientCount: 2 });
    expect(sender.previewAdminNotification).toHaveBeenCalledWith({
      mode: "broadcast",
      subject: undefined,
    });

    await request(createApp())
      .post("/api/admin/notifications/broadcast/send")
      .send({ title: "Notice", body: "Ferry update" })
      .expect(400);
    expect(sender.sendAdminNotification).not.toHaveBeenCalled();

    const target = "notification:broadcast";
    await request(createApp())
      .post("/api/admin/notifications/broadcast/send")
      .send({
        action: "send-broadcast-notification",
        body: "Ferry update",
        confirmation: getAdminConfirmationPhrase(
          "send-broadcast-notification",
          target
        ),
        target,
        title: "Notice",
      })
      .expect(200, {
        acceptedCount: 1,
        delivery: "not-confirmed",
        notSubmittedCount: 1,
        recipientCount: 2,
      });
    expect(sender.sendAdminNotification).toHaveBeenCalledWith({
      body: "Ferry update",
      mode: "broadcast",
      subject: undefined,
      title: "Notice",
    });
  });
});
