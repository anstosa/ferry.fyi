export interface SsrConfig {
  readonly cacheEnabled: boolean;
  readonly enabled: boolean;
}

export interface SsrConfigEnvironment {
  SSR_DOCUMENT_CACHE_ENABLED?: string;
  SSR_DOCUMENTS_ENABLED?: string;
}

const parseBoolean = (
  name: keyof SsrConfigEnvironment,
  value: string | undefined
) => {
  if (value === undefined) {
    return true;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  // Do not include a potentially secret environment value in the error.
  throw new Error(`${name} must be exactly true or false`);
};

/** Captures immutable SSR startup configuration without exposing env values. */
export const createSsrConfig = (
  environment: SsrConfigEnvironment = process.env
): SsrConfig =>
  Object.freeze({
    cacheEnabled: parseBoolean(
      "SSR_DOCUMENT_CACHE_ENABLED",
      environment.SSR_DOCUMENT_CACHE_ENABLED
    ),
    enabled: parseBoolean(
      "SSR_DOCUMENTS_ENABLED",
      environment.SSR_DOCUMENTS_ENABLED
    ),
  });
