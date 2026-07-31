import React, { startTransition, useEffect, useState } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import type { PublicSsrSnapshot } from "shared/contracts/ssr";
import {
  isPublicSsrDocumentMode,
  PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE,
  PUBLIC_SSR_SNAPSHOT_SCRIPT_ID,
  type PublicSsrDocumentMode,
} from "shared/contracts/ssrDocument";
import {
  getPublicSsrHostProfile,
  type PublicSsrHostProfile,
} from "shared/lib/ssrRouteMatch";

import { AppFrame } from "~/AppRoot";
import {
  type ClientRenderDiagnostic,
  type ClientRenderDiagnosticReporter,
  reportClientRenderDiagnostic,
} from "~/lib/clientRenderTelemetry";
import type { AppRenderContextValue } from "~/lib/renderContext";
import { readPublicSsrSeedResult } from "~/lib/ssrSeed";
import { UniversalRoutes } from "~/routes";

export type {
  ClientRenderDiagnostic,
  ClientRenderDiagnosticReporter,
} from "~/lib/clientRenderTelemetry";

type BrowserPhase = React.ComponentType<{
  hostProfile: PublicSsrHostProfile;
  suspendInitialRoute: boolean;
}>;
type BrowserModule = {
  BrowserPhase: BrowserPhase;
  preloadBrowserRoute: (
    pathname: string,
    hostProfile: PublicSsrHostProfile
  ) => Promise<void>;
};
type LoadBrowserPhase = () => Promise<BrowserModule>;
const loadDefaultBrowserPhase: LoadBrowserPhase = () => import("~/browserApp");
type ClientLocation = Pick<Location, "href" | "origin" | "pathname"> &
  Partial<Pick<Location, "host" | "hostname">>;

export const PUBLIC_SSR_SNAPSHOT_CONSUMED_ATTRIBUTE =
  "data-ferry-fyi-snapshot-consumed";

const defaultDiagnosticReporter: ClientRenderDiagnosticReporter = (
  diagnostic
) => {
  reportClientRenderDiagnostic(diagnostic);
  if (process.env.NODE_ENV !== "production") {
    // The object intentionally excludes Error.message and all document data.
    console.warn("Client render diagnostic", diagnostic);
  }
};

const reportReactDiagnostic = (
  category: Extract<ClientRenderDiagnostic["category"], `react-${string}`>,
  reporter: ClientRenderDiagnosticReporter
): void => {
  reporter({ category });
};

const readDocumentMode = (root: Element): PublicSsrDocumentMode | undefined => {
  const mode = root.getAttribute(PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE);
  return isPublicSsrDocumentMode(mode) ? mode : undefined;
};

export const InitialDocumentApp = ({
  documentMode,
  loadBrowserPhase = loadDefaultBrowserPhase,
  location = window.location,
  onCompatibleCommit,
  runtime,
  snapshot,
}: {
  documentMode?: PublicSsrDocumentMode;
  loadBrowserPhase?: LoadBrowserPhase;
  location?: ClientLocation;
  onCompatibleCommit?: () => void;
  runtime: "browser" | "hydrate";
  snapshot?: PublicSsrSnapshot;
}): React.ReactElement => {
  const [LivePhase, setLivePhase] = useState<BrowserPhase | null>(null);
  const isSnapshotDocument =
    documentMode === "snapshot" && runtime === "hydrate";
  const isNotFoundSnapshot = snapshot?.routeId === "unknown-public-path";
  const renderedAt = snapshot ? Date.parse(snapshot.renderedAt) : NaN;
  // document.baseURI can preserve an Auth callback query. Recovery may use
  // only the origin and pathname until the deferred browser phase begins.
  const safeUrl = new URL(location.pathname, location.origin);
  const hostProfile =
    snapshot?.hostProfile ??
    getPublicSsrHostProfile(location.hostname ?? location.host) ??
    "ferry.fyi";
  const seoPathname = snapshot?.canonicalPath ?? location.pathname;
  const context: Omit<AppRenderContextValue, "hasInjectedRequest"> = {
    clock: () => (Number.isFinite(renderedAt) ? renderedAt : Date.now()),
    platform: "web",
    requestUrl: isSnapshotDocument ? location.href : safeUrl.toString(),
    runtime,
    seoBaseUrl: isSnapshotDocument ? location.origin : safeUrl.origin,
    seoHost: hostProfile,
    seoPathname: isSnapshotDocument ? seoPathname : safeUrl.pathname,
  };

  useEffect(() => {
    onCompatibleCommit?.();
  }, [onCompatibleCommit]);

  useEffect(() => {
    // Auth, native bridges, storage-backed preferences, and API refreshes all
    // belong to the live application, after the document shell has committed.
    if (isNotFoundSnapshot) {
      return;
    }
    loadBrowserPhase().then(async ({ BrowserPhase, preloadBrowserRoute }) => {
      await preloadBrowserRoute(location.pathname, hostProfile);
      startTransition(() => setLivePhase(() => BrowserPhase));
    });
  }, [isNotFoundSnapshot, loadBrowserPhase]);

  const liveApp = LivePhase ? (
    <LivePhase hostProfile={hostProfile} suspendInitialRoute />
  ) : undefined;
  if (!isSnapshotDocument) {
    if (liveApp) {
      return <BrowserRouter>{liveApp}</BrowserRouter>;
    }
    return (
      <AppFrame context={context} snapshot={undefined}>
        <main aria-busy="true" data-client-recovery-shell="true" />
      </AppFrame>
    );
  }

  const seededApp =
    isNotFoundSnapshot || !liveApp ? (
      <UniversalRoutes />
    ) : (
      <React.Suspense fallback={<UniversalRoutes />}>{liveApp}</React.Suspense>
    );
  return (
    <BrowserRouter>
      <AppFrame context={context} snapshot={snapshot}>
        {seededApp}
      </AppFrame>
    </BrowserRouter>
  );
};

type RootFactory = (container: Element) => Root;
type HydrateFactory = (
  container: Element,
  initialChildren: React.ReactNode,
  options?: Parameters<typeof hydrateRoot>[2]
) => Root;

type InitialAppInput = {
  documentMode?: PublicSsrDocumentMode;
  onCompatibleCommit?: () => void;
  runtime: "browser" | "hydrate";
  snapshot?: PublicSsrSnapshot;
};

const createInitialDocumentApp = ({
  documentMode,
  onCompatibleCommit,
  runtime,
  snapshot,
}: InitialAppInput): React.ReactElement => (
  <InitialDocumentApp
    documentMode={documentMode}
    onCompatibleCommit={onCompatibleCommit}
    runtime={runtime}
    snapshot={snapshot}
  />
);

export const bootstrapClientApp = ({
  createApp = createInitialDocumentApp,
  createRootFactory = createRoot,
  document = window.document,
  hydrateRootFactory = hydrateRoot,
  reporter = defaultDiagnosticReporter,
}: {
  createApp?: (input: InitialAppInput) => React.ReactNode;
  createRootFactory?: RootFactory;
  document?: Document;
  hydrateRootFactory?: HydrateFactory;
  reporter?: ClientRenderDiagnosticReporter;
} = {}): "create" | "hydrate" => {
  const root = document.querySelector("#root");
  if (!root) {
    throw Error("Root element is not available");
  }
  const mode = readDocumentMode(root);
  const snapshotScripts = document.querySelectorAll(
    `script#${PUBLIC_SSR_SNAPSHOT_SCRIPT_ID}`
  );
  if (!mode) {
    reporter({
      category: root.hasAttribute(PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE)
        ? "public-ssr-integrity-invalid-mode"
        : "public-ssr-integrity-missing-mode",
    });
  }
  if (mode !== "snapshot" && snapshotScripts.length > 0) {
    reporter({ category: "public-ssr-integrity-unexpected-snapshot" });
    snapshotScripts.forEach((script) => script.remove());
  }
  const seed =
    mode === "snapshot" ? readPublicSsrSeedResult(document) : undefined;
  const hasCompatibleSnapshot = Boolean(seed?.snapshot);
  const hasRenderedRoot = root.hasChildNodes();
  const shouldHydrate =
    mode === "snapshot" && hasCompatibleSnapshot && hasRenderedRoot;
  if (mode === "snapshot" && seed?.category) {
    reporter({ category: seed.category });
  }
  if (mode === "snapshot" && hasCompatibleSnapshot && !hasRenderedRoot) {
    reporter({ category: "public-ssr-integrity-missing-rendered-root" });
  }
  if (mode === "snapshot" && !shouldHydrate) {
    snapshotScripts.forEach((script) => script.remove());
  }
  if (shouldHydrate) {
    let hydrationFailed = false;
    const failHydration = (
      category: Extract<ClientRenderDiagnostic["category"], `react-${string}`>
    ) => {
      hydrationFailed = true;
      reportReactDiagnostic(category, reporter);
    };
    const hydratedApp = createApp({
      documentMode: mode,
      onCompatibleCommit: () => {
        if (hydrationFailed) {
          return;
        }
        root.setAttribute(PUBLIC_SSR_SNAPSHOT_CONSUMED_ATTRIBUTE, "true");
        snapshotScripts.forEach((script) => script.remove());
      },
      runtime: "hydrate",
      snapshot: seed?.snapshot,
    });
    hydrateRootFactory(root, hydratedApp, {
      onCaughtError: () => failHydration("react-caught-error"),
      onRecoverableError: () => failHydration("react-recoverable-error"),
      onUncaughtError: () => failHydration("react-uncaught-error"),
    });
    return "hydrate";
  }
  const app = createApp({
    documentMode: mode,
    onCompatibleCommit: undefined,
    runtime: "browser",
    snapshot: seed?.snapshot,
  });
  createRootFactory(root).render(app);
  return "create";
};

export const startClientAppWhenReady = (
  document: Document = window.document
): void => {
  const start = () => bootstrapClientApp({ document });
  if (document.readyState !== "loading") {
    start();
    return;
  }
  document.addEventListener("DOMContentLoaded", start, { once: true });
};
