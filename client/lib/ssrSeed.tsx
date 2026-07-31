import React, {
  createContext,
  type PropsWithChildren,
  useContext,
} from "react";
import {
  PUBLIC_SSR_FORBIDDEN_KEYS,
  type PublicSsrPayloadMap,
  type PublicSsrSnapshot,
  type PublicSsrSourceKey,
  type PublicSsrSourceOutcome,
} from "shared/contracts/ssr";
import { PUBLIC_SSR_SNAPSHOT_SCRIPT_ID } from "shared/contracts/ssrDocument";
import { assertPublicSsrSnapshot } from "shared/lib/ssrValidation";

export type PublicSsrSeedIntegrityCategory =
  | "public-ssr-integrity-missing-snapshot"
  | "public-ssr-integrity-duplicate-snapshot"
  | "public-ssr-integrity-invalid-snapshot"
  | "public-ssr-integrity-invalid-mode"
  | "public-ssr-integrity-missing-mode"
  | "public-ssr-integrity-missing-rendered-root"
  | "public-ssr-integrity-unexpected-snapshot";

export type PublicSsrSeedReadResult =
  | { category: PublicSsrSeedIntegrityCategory; snapshot: undefined }
  | { category: undefined; snapshot: PublicSsrSnapshot };

const containsForbiddenKey = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenKey);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(
    ([key, child]) =>
      (PUBLIC_SSR_FORBIDDEN_KEYS as readonly string[]).includes(key) ||
      containsForbiddenKey(child)
  );
};

/**
 * Reads the server-validated anonymous snapshot without consulting storage or
 * making a request. The server remains the authoritative structural validator;
 * this boundary rejects malformed or unsafe handoff data before first render.
 */
export const readPublicSsrSeedResult = (
  document: Pick<Document, "querySelectorAll">
): PublicSsrSeedReadResult => {
  const elements = document.querySelectorAll(
    `script#${PUBLIC_SSR_SNAPSHOT_SCRIPT_ID}`
  );
  if (elements.length === 0) {
    return {
      category: "public-ssr-integrity-missing-snapshot",
      snapshot: undefined,
    };
  }
  if (elements.length !== 1) {
    return {
      category: "public-ssr-integrity-duplicate-snapshot",
      snapshot: undefined,
    };
  }
  const element = elements[0];
  if (
    element.getAttribute("type") !== "application/json" ||
    !element.textContent
  ) {
    return {
      category: "public-ssr-integrity-invalid-snapshot",
      snapshot: undefined,
    };
  }
  try {
    const value: unknown = JSON.parse(element.textContent);
    if (containsForbiddenKey(value)) {
      return {
        category: "public-ssr-integrity-invalid-snapshot",
        snapshot: undefined,
      };
    }
    return { category: undefined, snapshot: assertPublicSsrSnapshot(value) };
  } catch {
    return {
      category: "public-ssr-integrity-invalid-snapshot",
      snapshot: undefined,
    };
  }
};

export const readPublicSsrSeed = (
  document: Pick<Document, "querySelectorAll">
): PublicSsrSnapshot | undefined => readPublicSsrSeedResult(document).snapshot;

/**
 * Anonymous, already-validated document data.  This deliberately has no
 * browser storage or request side effects: consumers can use it during the
 * first render and their normal effects remain responsible for refreshing it.
 */
export const PublicSsrSeedContext = createContext<
  PublicSsrSnapshot | undefined
>(undefined);

export const PublicSsrSeedProvider = ({
  children,
  snapshot,
}: PropsWithChildren<{ snapshot?: PublicSsrSnapshot }>): React.ReactElement => (
  <PublicSsrSeedContext.Provider value={snapshot}>
    {children}
  </PublicSsrSeedContext.Provider>
);

export const usePublicSsrSnapshot = (): PublicSsrSnapshot | undefined =>
  useContext(PublicSsrSeedContext);

/** Preserve the loader's explicit value/empty/stale/unavailable distinction. */
export const getPublicSsrSourceOutcome = <K extends PublicSsrSourceKey>(
  snapshot: PublicSsrSnapshot | undefined,
  key: K
): PublicSsrSourceOutcome<K> | undefined =>
  (
    snapshot?.sources as
      | Partial<Record<PublicSsrSourceKey, PublicSsrSourceOutcome<K>>>
      | undefined
  )?.[key];

export const usePublicSsrSourceOutcome = <K extends PublicSsrSourceKey>(
  key: K
): PublicSsrSourceOutcome<K> | undefined =>
  getPublicSsrSourceOutcome(usePublicSsrSnapshot(), key);

/** Read only a value/stale value; unavailable sources must never masquerade as data. */
export const getPublicSsrSource = <K extends PublicSsrSourceKey>(
  snapshot: PublicSsrSnapshot | undefined,
  key: K
): PublicSsrPayloadMap[K] | undefined => {
  const source = getPublicSsrSourceOutcome(snapshot, key);
  return source?.outcome === "value" || source?.outcome === "stale-usable"
    ? source.value
    : undefined;
};

export const usePublicSsrSource = <K extends PublicSsrSourceKey>(
  key: K
): PublicSsrPayloadMap[K] | undefined =>
  getPublicSsrSource(usePublicSsrSnapshot(), key);
