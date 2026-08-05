const configuredOrigins = (): Set<string> =>
  new Set(
    [
      process.env.BASE_URL,
      ...(process.env.TRUSTED_API_ORIGINS ?? "").split(","),
    ].flatMap((value) => {
      try {
        return value?.trim() ? [new URL(value.trim()).origin] : [];
      } catch {
        return [];
      }
    })
  );

const isDevelopmentLoopbackOrigin = (origin: string): boolean => {
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
};

/** Allows the browser origin while preserving split local Vite/API development. */
export const isTrustedAdMutationOrigin = (
  origin: string,
  requestOrigin: string
): boolean =>
  origin !== "null" &&
  (origin === requestOrigin ||
    configuredOrigins().has(origin) ||
    isDevelopmentLoopbackOrigin(origin));
