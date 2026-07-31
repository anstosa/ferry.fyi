import type { PublicSsrSeedIntegrityCategory } from "./ssrSeed";

export type ClientRenderDiagnostic = {
  category:
    | PublicSsrSeedIntegrityCategory
    | "browser-phase-load-error"
    | "react-caught-error"
    | "react-recoverable-error"
    | "react-uncaught-error";
};

export type ClientRenderDiagnosticReporter = (
  diagnostic: ClientRenderDiagnostic
) => void;

let sink: ClientRenderDiagnosticReporter | undefined;
const pending: ClientRenderDiagnostic[] = [];

/**
 * Hydration can report before the deferred browser runtime initializes Sentry.
 * Keep only the categorical, privacy-safe diagnostic until a sink is ready.
 */
export const reportClientRenderDiagnostic: ClientRenderDiagnosticReporter = (
  diagnostic
) => {
  if (sink) {
    sink(diagnostic);
    return;
  }
  pending.push(diagnostic);
};

export const installClientRenderDiagnosticSink = (
  nextSink: ClientRenderDiagnosticReporter
): (() => void) => {
  sink = nextSink;
  pending.splice(0).forEach(nextSink);
  return () => {
    if (sink === nextSink) {
      sink = undefined;
    }
  };
};
