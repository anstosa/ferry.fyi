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
const HEAD_CLOSE = "</head>";
const BODY_CLOSE = "</body>";

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
  const rootWithMode = root[0].replace(
    ">",
    ` ${PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE}="${mode}">`
  );
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
  return removeSeoSeedFallback(replaceRootContents(template, mode, appMarkup))
    .replace(HEAD_CLOSE, `${helmetMarkup(helmetContext)}${HEAD_CLOSE}`)
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
    `<title>Ferry FYI</title><meta name="robots" content="noindex,nofollow">${HEAD_CLOSE}`
  );
