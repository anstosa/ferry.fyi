/**
 * The CJS server loads this narrow, data-only contract from the built ESM
 * renderer. Keeping React types out of it prevents the server bundle from
 * becoming a second renderer implementation.
 */
export const PUBLIC_SSR_RENDERER_ARTIFACT_VERSION = 1 as const;

export interface PublicSsrRenderDocumentInput {
  /** Epoch milliseconds used to make server markup deterministic. */
  renderedAt: number;
  requestUrl: string;
  seoBaseUrl: string;
  seoHost: string;
  seoPathname: string;
  /** Untrusted JSON is validated inside the ESM renderer. */
  snapshot: unknown;
  template: string;
}

export interface PublicSsrRenderDocumentResult {
  html: string;
  mode: "snapshot";
}

export interface PublicSsrRendererArtifact {
  artifactVersion: typeof PUBLIC_SSR_RENDERER_ARTIFACT_VERSION;
  renderPublicSsrDocument(
    input: PublicSsrRenderDocumentInput
  ): Promise<PublicSsrRenderDocumentResult>;
}
