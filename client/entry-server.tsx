import React, { type ReactElement } from "react";
import type { PublicSsrSnapshot } from "shared/contracts/ssr";
import {
  PUBLIC_SSR_RENDERER_ARTIFACT_VERSION,
  type PublicSsrRenderDocumentInput,
  type PublicSsrRenderDocumentResult,
} from "shared/contracts/ssrRenderer";
import { assemblePublicSsrDocument } from "shared/lib/ssrDocumentTemplate";
import { renderSsrStreamToString } from "shared/lib/ssrStream";
import { assertPublicSsrSnapshot } from "shared/lib/ssrValidation";

import { AppRoot } from "./AppRoot";
import type { AppRenderContextValue } from "./lib/renderContext";

export interface ServerAppInput {
  context: Omit<AppRenderContextValue, "hasInjectedRequest">;
  helmetContext: Record<string, unknown>;
  snapshot: PublicSsrSnapshot;
}

/**
 * The server bundle imports this narrow entry point rather than browser setup.
 * Keeping its input explicit makes document rendering deterministic and lets
 * the server inject it when loading a production SSR bundle.
 */
export const createServerApp = ({
  context,
  helmetContext,
  snapshot,
}: ServerAppInput): ReactElement =>
  React.createElement(AppRoot, { context, helmetContext, snapshot });

/** The deployable ESM renderer entry consumed by the production server. */
export const renderPublicSsrDocument = async ({
  renderedAt,
  requestUrl,
  seoBaseUrl,
  seoHost,
  seoPathname,
  snapshot: inputSnapshot,
  template,
}: PublicSsrRenderDocumentInput): Promise<PublicSsrRenderDocumentResult> => {
  const snapshot = assertPublicSsrSnapshot(inputSnapshot);
  const context: ServerAppInput["context"] = {
    clock: () => renderedAt,
    platform: "web",
    requestUrl,
    runtime: "server",
    seoBaseUrl,
    seoHost,
    seoPathname,
  };
  const helmetContext: Record<string, unknown> = {};
  const appMarkup = await renderSsrStreamToString(
    createServerApp({ context, helmetContext, snapshot })
  );
  return {
    html: assemblePublicSsrDocument({
      appMarkup,
      helmetContext,
      snapshot,
      template,
    }),
    mode: "snapshot",
  };
};

export const artifactVersion = PUBLIC_SSR_RENDERER_ARTIFACT_VERSION;
