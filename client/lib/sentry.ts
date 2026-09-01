import { Capacitor } from "@capacitor/core";

import { installClientRenderDiagnosticSink } from "~/lib/clientRenderTelemetry";
import { installExceptionReporter } from "~/lib/errorReporting";

type DiagnosticClient = {
  captureException: (typeof import("@sentry/react"))["captureException"];
  captureMessage: (typeof import("@sentry/react"))["captureMessage"];
  getClient: (typeof import("@sentry/react"))["getClient"];
};

type SentryCapacitorClient = Pick<
  typeof import("@sentry/capacitor"),
  | "browserTracingIntegration"
  | "captureException"
  | "captureMessage"
  | "getClient"
  | "init"
>;

type SentryWebClient = Pick<
  typeof import("~/lib/sentry-web"),
  | "browserTracingIntegration"
  | "captureException"
  | "captureMessage"
  | "getClient"
  | "init"
>;

type SentryReactInit = Pick<typeof import("@sentry/react"), "init">;

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

const installDiagnosticSink = (Sentry: DiagnosticClient): (() => void) => {
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

const installSentrySinks = (Sentry: DiagnosticClient): (() => void) => {
  const removeDiagnosticSink = installDiagnosticSink(Sentry);
  const removeExceptionReporter = installExceptionReporter(
    Sentry.captureException
  );
  return () => {
    removeDiagnosticSink();
    removeExceptionReporter();
  };
};

export const initializeSentry = async ({
  dsn = process.env.SENTRY_DSN,
  loadNative = () => import("@sentry/capacitor"),
  loadNativeReact = () => import("@sentry/react"),
  loadWeb = () => import("~/lib/sentry-web"),
  native = Capacitor.isNativePlatform(),
}: {
  dsn?: string;
  loadNative?: () => Promise<SentryCapacitorClient>;
  loadNativeReact?: () => Promise<SentryReactInit>;
  loadWeb?: () => Promise<SentryWebClient>;
  native?: boolean;
} = {}): Promise<() => void> => {
  if (!dsn) {
    return installExceptionReporter(() => undefined);
  }
  const commonOptions = {
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.25,
  };
  if (!native) {
    const Sentry = await loadWeb();
    Sentry.init({
      ...commonOptions,
      integrations: [Sentry.browserTracingIntegration()],
      release: `web@${process.env.RELEASE_VERSION || "DEVELOPMENT"}`,
    });
    return installSentrySinks(Sentry);
  }

  const [Sentry, SentryReact] = await Promise.all([
    loadNative(),
    loadNativeReact(),
  ]);
  Sentry.init(
    {
      ...commonOptions,
      attachThreads: true,
      enableAppHangTracking: true,
      enableNative: true,
      enableNativeCrashHandling: true,
      integrations: [Sentry.browserTracingIntegration()],
    },
    SentryReact.init
  );
  return installSentrySinks(Sentry);
};

let sentryStartup: Promise<() => void> | undefined;

export const startSentry = (): Promise<() => void> => {
  sentryStartup ??= initializeSentry();
  return sentryStartup;
};
