import type { ReactElement } from "react";
import type { PublicSsrSnapshot } from "shared/contracts/ssr";
import type { PublicSsrRenderDocumentResult } from "shared/contracts/ssrRenderer";
import { assemblePublicSsrDocument } from "shared/lib/ssrDocumentTemplate";
import {
  renderSsrStreamToString,
  type SsrStreamRenderer,
} from "shared/lib/ssrStream";
import { assertPublicSsrSnapshot } from "shared/lib/ssrValidation";

export {
  assemblePublicSsrDocument,
  assemblePublicSsrMarkerDocument,
  serializePublicSsrSnapshot,
} from "shared/lib/ssrDocumentTemplate";

export interface PublicSsrRenderContext {
  clock: () => number;
  platform: "android" | "ios" | "web";
  requestUrl: string;
  runtime: "server";
  seoBaseUrl: string;
  seoHost: string;
  seoPathname: string;
}

export interface PublicSsrServerEntry {
  createServerApp(input: {
    context: PublicSsrRenderContext;
    helmetContext: Record<string, unknown>;
    snapshot: PublicSsrSnapshot;
  }): ReactElement;
}

export interface PublicSsrDocumentInput {
  context: PublicSsrRenderContext;
  entry: PublicSsrServerEntry;
  snapshot: unknown;
  template: string;
}

export type PublicSsrDocumentResult = PublicSsrRenderDocumentResult;

export type PublicSsrStreamRenderer = SsrStreamRenderer;

/** Buffers only an all-ready stream; any render error rejects before assembly. */
export const renderPublicSsrApp = (
  element: ReactElement,
  renderer?: PublicSsrStreamRenderer
): Promise<string> => renderSsrStreamToString(element, renderer);

export const renderPublicSsrDocument = async ({
  context,
  entry,
  snapshot: inputSnapshot,
  template,
}: PublicSsrDocumentInput): Promise<PublicSsrDocumentResult> => {
  // Validation must precede rendering so untrusted data cannot enter React or JSON.
  const snapshot = assertPublicSsrSnapshot(inputSnapshot);
  const helmetContext: Record<string, unknown> = {};
  const appMarkup = await renderPublicSsrApp(
    entry.createServerApp({ context, helmetContext, snapshot })
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
