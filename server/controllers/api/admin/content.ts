import { Router } from "express";

import { requireTypedConfirmation } from "./confirmation";

export const adminContentRouter = Router();
const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

adminContentRouter.get("/", async (_request, response) =>
  response.send(await (await import("~/lib/admin/content")).getAdminContent())
);

adminContentRouter.post(
  "/announcements",
  requireTypedConfirmation({
    action: "publish-announcement",
    getTarget: () => "announcement:new",
  }),
  async (request, response) => {
    try {
      const {
        action: _action,
        target: _target,
        ...announcement
      } = request.body;
      const { createAnnouncement } = await import("~/lib/admin/content");
      response.status(201).send(await createAnnouncement(announcement));
    } catch (error) {
      response.status(400).send({
        error: error instanceof Error ? error.message : "Invalid announcement",
      });
    }
  }
);

adminContentRouter.put(
  "/announcements/:id",
  requireTypedConfirmation({
    action: "publish-announcement",
    getTarget: (request) =>
      isUuid(request.params.id)
        ? `announcement:${request.params.id}`
        : undefined,
  }),
  async (request, response) => {
    try {
      const { saveAnnouncement } = await import("~/lib/admin/content");
      response.send(await saveAnnouncement(request.params.id, request.body));
    } catch (error) {
      response.status(400).send({
        error: error instanceof Error ? error.message : "Invalid announcement",
      });
    }
  }
);

adminContentRouter.put(
  "/maintenance",
  requireTypedConfirmation({
    action: "set-maintenance-banner",
    getTarget: () => "site:maintenance",
  }),
  async (request, response) => {
    try {
      const { setMaintenance } = await import("~/lib/admin/content");
      response.send(await setMaintenance(request.body));
    } catch (error) {
      response.status(400).send({
        error:
          error instanceof Error ? error.message : "Invalid maintenance banner",
      });
    }
  }
);

adminContentRouter.put(
  "/settings",
  requireTypedConfirmation({
    action: "save-site-settings",
    getTarget: () => "site:settings",
  }),
  async (request, response) => {
    try {
      const { action: _action, target: _target, ...settings } = request.body;
      const { saveSiteSettings } = await import("~/lib/admin/content");
      response.send(await saveSiteSettings(settings));
    } catch (error) {
      response.status(400).send({
        error: error instanceof Error ? error.message : "Invalid site settings",
      });
    }
  }
);

adminContentRouter.put(
  "/crawler-policy",
  requireTypedConfirmation({
    action: "update-crawler-policy",
    getTarget: () => "site:crawler-policy",
  }),
  async (request, response) => {
    try {
      const { setCrawlerPolicy } = await import("~/lib/admin/content");
      response.send(await setCrawlerPolicy(request.body));
    } catch (error) {
      response.status(400).send({
        error:
          error instanceof Error ? error.message : "Invalid crawler policy",
      });
    }
  }
);

adminContentRouter.put(
  "/leaderboard-discovery",
  requireTypedConfirmation({
    action: "update-crawler-policy",
    getTarget: () => "site:leaderboard-discovery",
  }),
  async (request, response) => {
    try {
      const { setLeaderboardDiscovery } = await import("~/lib/admin/content");
      response.send(await setLeaderboardDiscovery(request.body));
    } catch (error) {
      response.status(400).send({
        error:
          error instanceof Error
            ? error.message
            : "Invalid leaderboard discovery policy",
      });
    }
  }
);
