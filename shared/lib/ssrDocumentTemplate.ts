import {
  PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE,
  PUBLIC_SSR_SNAPSHOT_SCRIPT_ID,
  type PublicSsrDocumentMode,
} from "shared/contracts/ssrDocument";

import { assertPublicSsrSnapshot } from "./ssrValidation";

type HelmetTag = { toString(): string };
type HelmetContext = {
  helmet?: Partial<
    Record<
      "link" | "meta" | "noscript" | "script" | "style" | "title",
      HelmetTag
    >
  >;
};

const ROOT_OPEN = /<div\b([^>]*\bid=(['"])root\2[^>]*)>/i;
const APP_SHELL_OPEN =
  /<div\b(?=[^>]*\bdata-app-transition-shell=(['"])true\1)[^>]*>/i;
const NATIVE_HEAD_ELEMENT =
  /^(?:\s+|<title\b[^>]*>[\s\S]*?<\/title>|<(?:meta|link)\b[^>]*\/?>|<style\b[^>]*>[\s\S]*?<\/style>|<script\b(?=[^>]*\basync(?:\s|=|>))(?=[^>]*\bsrc\s*=)[^>]*>\s*<\/script>)/i;
const HEAD_CLOSE = "</head>";
const BODY_CLOSE = "</body>";
const MARKER_DESCRIPTION =
  "Ferry FYI provides Washington State Ferries schedules, route status, terminal information, and travel planning tools.";

const replaceRootContents = (
  template: string,
  mode: PublicSsrDocumentMode,
  contents: string
): string => {
  const root = template.match(ROOT_OPEN);
  if (
    !root ||
    !template.includes(HEAD_CLOSE) ||
    !template.includes(BODY_CLOSE)
  ) {
    throw new Error(
      "SSR document template is missing a required document boundary"
    );
  }
  const tag = /<\/?div\b[^>]*>/gi;
  tag.lastIndex = root.index!;
  let depth = 0;
  let rootEnd = -1;
  let rootClose = "";
  for (let match = tag.exec(template); match; match = tag.exec(template)) {
    const isClosing = /^<\//.test(match[0]);
    const isSelfClosing = /\/>$/.test(match[0]);
    if (isClosing) {
      depth -= 1;
    } else if (!isSelfClosing) {
      depth += 1;
    }
    if (depth === 0) {
      rootEnd = tag.lastIndex;
      rootClose = match[0];
      break;
    }
  }
  if (rootEnd < 0) {
    throw new Error("SSR document template is missing #root closing tag");
  }
  const rootWithMode = `${root[0].slice(
    0,
    -1
  )} ${PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE}="${mode}">`;
  return (
    template.slice(0, root.index) +
    rootWithMode +
    contents +
    rootClose +
    template.slice(rootEnd)
  );
};

const removeSeoSeedFallback = (template: string): string =>
  template
    .replace(/<script\b[^>]*\bdata-seo-seed\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<title\b[^>]*\bdata-seo-seed\b[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(/<(?:meta|link)\b[^>]*\bdata-seo-seed\b[^>]*>/gi, "");

export const serializePublicSsrSnapshot = (input: unknown): string =>
  JSON.stringify(assertPublicSsrSnapshot(input))
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

const helmetMarkup = (context: HelmetContext): string =>
  [
    context.helmet?.title,
    context.helmet?.meta,
    context.helmet?.link,
    context.helmet?.script,
    context.helmet?.style,
    context.helmet?.noscript,
  ]
    .flatMap((tag) => (tag ? [tag.toString()] : []))
    .join("");

interface SsrAppMarkup {
  bodyMarkup: string;
  nativeHeadMarkup: string;
}

// separate only React's controlled document prefix from the known app shell
const splitNativeHeadMarkup = (appMarkup: string): SsrAppMarkup => {
  const shell = appMarkup.match(APP_SHELL_OPEN);
  // keep synthetic legacy markup on the explicit Helmet context path
  if (!shell || shell.index === undefined) {
    return { bodyMarkup: appMarkup, nativeHeadMarkup: "" };
  }
  const bodyMarkup = appMarkup.slice(shell.index);
  // reject an ambiguous hydration boundary rather than moving arbitrary markup
  if (APP_SHELL_OPEN.test(bodyMarkup.slice(shell[0].length))) {
    throw new Error("SSR app markup contains an ambiguous app shell boundary");
  }
  const nativeHeadMarkup = appMarkup.slice(0, shell.index);
  let unvalidated = nativeHeadMarkup;
  // accept only document metadata and React resource hints before the shell
  while (unvalidated) {
    const element = unvalidated.match(NATIVE_HEAD_ELEMENT);
    // reject arbitrary prefix markup instead of moving it into the document head
    if (!element) {
      throw new Error("SSR app markup contains an unsupported head prefix");
    }
    unvalidated = unvalidated.slice(element[0].length);
  }
  return { bodyMarkup, nativeHeadMarkup };
};

// assemble one validated public snapshot document with one metadata source
export const assemblePublicSsrDocument = ({
  appMarkup,
  helmetContext,
  snapshot,
  template,
}: {
  appMarkup: string;
  helmetContext: HelmetContext;
  snapshot: unknown;
  template: string;
}): string => {
  const mode: PublicSsrDocumentMode = "snapshot";
  const validatedSnapshot = assertPublicSsrSnapshot(snapshot);
  const legacyHeadMarkup = helmetMarkup(helmetContext);
  const { bodyMarkup, nativeHeadMarkup } = splitNativeHeadMarkup(appMarkup);
  // prevent duplicate metadata when both Helmet protocols produce output
  if (nativeHeadMarkup && legacyHeadMarkup) {
    throw new Error("SSR document contains conflicting head metadata sources");
  }
  const headMarkup = nativeHeadMarkup || legacyHeadMarkup;
  // fail closed only for the production app shell metadata contract
  if (!headMarkup.trim() && APP_SHELL_OPEN.test(bodyMarkup)) {
    throw new Error("SSR app shell is missing head metadata");
  }
  return removeSeoSeedFallback(replaceRootContents(template, mode, bodyMarkup))
    .replace(HEAD_CLOSE, `${headMarkup}${HEAD_CLOSE}`)
    .replace(
      BODY_CLOSE,
      `<script id="${PUBLIC_SSR_SNAPSHOT_SCRIPT_ID}" type="application/json">${serializePublicSsrSnapshot(validatedSnapshot)}</script>${BODY_CLOSE}`
    );
};

export const assemblePublicSsrMarkerDocument = (
  template: string,
  mode: Exclude<PublicSsrDocumentMode, "snapshot">
): string =>
  removeSeoSeedFallback(replaceRootContents(template, mode, "")).replace(
    HEAD_CLOSE,
    `<title>Ferry FYI</title><meta data-seo-seed="true" name="description" content="${MARKER_DESCRIPTION}"><meta name="robots" content="noindex,nofollow">${HEAD_CLOSE}`
  );
