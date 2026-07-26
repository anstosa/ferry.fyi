import { Request, Response, Router } from "express";

import { requireTypedConfirmation } from "./confirmation";

export const adminNotificationsRouter = Router();

adminNotificationsRouter.get(
  "/",
  async (_request: Request, response: Response) => {
    // Keep the admin composition root importable for authorization checks
    // without constructing the database-backed notification models.
    const { getNotificationDashboard } =
      await import("~/lib/admin/notificationStatus");
    response.send(await getNotificationDashboard());
  }
);

const notificationTarget = (): string => "notification-policy:global";

adminNotificationsRouter.post(
  "/pause",
  requireTypedConfirmation({
    action: "pause-notifications",
    getTarget: notificationTarget,
  }),
  async (_request: Request, response: Response) => {
    const { setNotificationsPaused } =
      await import("~/lib/admin/notificationPolicy");
    response.send({ policy: await setNotificationsPaused(true) });
  }
);

adminNotificationsRouter.post(
  "/resume",
  requireTypedConfirmation({
    action: "resume-notifications",
    getTarget: notificationTarget,
  }),
  async (_request: Request, response: Response) => {
    const { setNotificationsPaused } =
      await import("~/lib/admin/notificationPolicy");
    response.send({ policy: await setNotificationsPaused(false) });
  }
);

const isNotificationContent = (
  input: unknown
): input is { body: string; title: string } =>
  typeof input === "object" &&
  input !== null &&
  typeof (input as { title?: unknown }).title === "string" &&
  typeof (input as { body?: unknown }).body === "string" &&
  (input as { title: string }).title.trim().length > 0 &&
  (input as { title: string }).title.length <= 120 &&
  (input as { body: string }).body.trim().length > 0 &&
  (input as { body: string }).body.length <= 500;

const requestSubject = (request: Request): string | undefined =>
  request.auth?.payload.sub;

const targetedSubject = (request: Request): string | undefined =>
  typeof request.params.subject === "string" &&
  request.params.subject.length <= 300
    ? request.params.subject
    : undefined;

const notificationAction = async (
  request: Request,
  response: Response,
  mode: "broadcast" | "targeted" | "test",
  subject?: string
): Promise<void> => {
  if (!isNotificationContent(request.body)) {
    response.status(400).send({ error: "Invalid notification content" });
    return;
  }
  const { sendAdminNotification } =
    await import("~/lib/admin/notificationSend");
  response.send(
    await sendAdminNotification({
      body: request.body.body.trim(),
      mode,
      subject,
      title: request.body.title.trim(),
    })
  );
};

const previewNotification = async (
  request: Request,
  response: Response,
  mode: "broadcast" | "targeted" | "test",
  subject?: string
): Promise<void> => {
  if (!isNotificationContent(request.body)) {
    response.status(400).send({ error: "Invalid notification content" });
    return;
  }
  const { previewAdminNotification } =
    await import("~/lib/admin/notificationSend");
  response.send(await previewAdminNotification({ mode, subject }));
};

adminNotificationsRouter.post("/broadcast/preview", (request, response) =>
  previewNotification(request, response, "broadcast")
);
adminNotificationsRouter.post(
  "/broadcast/send",
  requireTypedConfirmation({
    action: "send-broadcast-notification",
    getTarget: () => "notification:broadcast",
  }),
  (request, response) => notificationAction(request, response, "broadcast")
);

adminNotificationsRouter.post(
  "/targeted/:subject/preview",
  (request, response) =>
    previewNotification(request, response, "targeted", targetedSubject(request))
);
adminNotificationsRouter.post(
  "/targeted/:subject/send",
  requireTypedConfirmation({
    action: "send-targeted-notification",
    getTarget: (request) => {
      const subject = targetedSubject(request);
      return subject ? `notification:targeted:${subject}` : undefined;
    },
  }),
  (request, response) =>
    notificationAction(request, response, "targeted", targetedSubject(request))
);

adminNotificationsRouter.post("/test/preview", (request, response) =>
  previewNotification(request, response, "test", requestSubject(request))
);
adminNotificationsRouter.post(
  "/test/send",
  requireTypedConfirmation({
    action: "send-test-notification",
    getTarget: (request) => {
      const subject = requestSubject(request);
      return subject ? `notification:test:${subject}` : undefined;
    },
  }),
  (request, response) =>
    notificationAction(request, response, "test", requestSubject(request))
);
