import { Capacitor } from "@capacitor/core";

import { installClientRenderDiagnosticSink } from "~/lib/clientRenderTelemetry";

type SentryCapacitorClient = Pick<
  typeof import("@sentry/capacitor"),
  "browserTracingIntegration" | "captureMessage" | "init"
> & {
  getClient(): unknown;
};

type SentryReactClient = Pick<typeof import("@sentry/react"), "init">;

const SENTRY_CLIENT_READY_POLL_MS = 25;
const SENTRY_CLIENT_READY_ATTEMPTS = 100;

const waitForSentryClient = async (
  getClient: () => unknown
): Promise<boolean> => {
  for (let attempt = 0; attempt < SENTRY_CLIENT_READY_ATTEMPTS; attempt += 1) {
    if (getClient()) {
      return true;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, SENTRY_CLIENT_READY_POLL_MS)
    );
  }
  return false;
};

export const initializeSentry = async ({
  dsn = process.env.SENTRY_DSN,
  native = Capacitor.isNativePlatform(),
  load = () => import("@sentry/capacitor"),
  loadReact = () => import("@sentry/react"),
}: {
  dsn?: string;
  native?: boolean;
  load?: () => Promise<SentryCapacitorClient>;
  loadReact?: () => Promise<SentryReactClient>;
} = {}): Promise<() => void> => {
  if (!dsn) {
    return () => undefined;
  }
  const [Sentry, SentryReact] = await Promise.all([load(), loadReact()]);
  Sentry.init(
    {
      attachThreads: native,
      dsn,
      enableAppHangTracking: native,
      enableNative: native,
      enableNativeCrashHandling: native,
      environment: process.env.NODE_ENV,
      ...(!native && {
        release: `web@${process.env.HEROKU_RELEASE_VERSION || "DEVELOPMENT"}`,
      }),
      tracesSampleRate: 0.25,
      integrations: [Sentry.browserTracingIntegration()],
    },
    SentryReact.init
  );
  const clientReady = waitForSentryClient(Sentry.getClient).catch(() => false);
  return installClientRenderDiagnosticSink(({ category }) => {
    clientReady.then((ready) => {
      if (!ready) {
        return;
      }
      Sentry.captureMessage("Client render diagnostic", {
        level: "warning",
        tags: { category },
      });
    });
  });
};

let sentryStartup: Promise<() => void> | undefined;

export const startSentry = (): Promise<() => void> => {
  sentryStartup ??= initializeSentry();
  return sentryStartup;
};
