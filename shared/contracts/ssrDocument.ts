/**
 * DOM protocol shared by the server document renderer and browser hydration.
 * These values are intentionally public and contain no request-specific data.
 */
export const PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE = "data-ferry-fyi-render-mode";
export const PUBLIC_SSR_SNAPSHOT_SCRIPT_ID = "ferry-fyi-public-ssr-snapshot";

/**
 * Non-snapshot modes are deliberately coarse: they must never carry a URL,
 * query value, error message, or other request data into the document.
 */
export const PUBLIC_SSR_DOCUMENT_MODES = [
  "snapshot",
  "private",
  "callback",
  "disabled",
  "failure",
] as const;

export type PublicSsrDocumentMode = (typeof PUBLIC_SSR_DOCUMENT_MODES)[number];

export const isPublicSsrDocumentMode = (
  value: unknown
): value is PublicSsrDocumentMode =>
  typeof value === "string" &&
  (PUBLIC_SSR_DOCUMENT_MODES as readonly string[]).includes(value);
