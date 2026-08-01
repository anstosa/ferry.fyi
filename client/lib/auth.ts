type Auth0RedirectUriOptions = {
  domain: string;
  platform?: string;
  redirectUri: string;
};

export const getAuth0RedirectUri = ({
  domain,
  // Native callers pass their platform from the browser runtime adapter.
  // Public render imports must remain independent of Capacitor.
  platform = "web",
  redirectUri,
}: Auth0RedirectUriOptions): string => {
  if (platform === "android") {
    return `fyi.ferry://${domain}/capacitor/fyi.ferry/callback`;
  }

  return redirectUri;
};

export const getConfiguredAuth0RedirectUri = (platform?: string): string =>
  getAuth0RedirectUri({
    domain: process.env.AUTH0_DOMAIN as string,
    platform,
    redirectUri: process.env.AUTH0_CLIENT_REDIRECT as string,
  });

export const isAuth0CallbackUrl = (
  url: string,
  redirectUri = getConfiguredAuth0RedirectUri()
): boolean => {
  try {
    const candidate = new URL(url);
    const callback = new URL(redirectUri);
    const candidatePath = candidate.pathname || "/";
    const callbackPath = callback.pathname || "/";

    return (
      candidate.protocol === callback.protocol &&
      candidate.host === callback.host &&
      candidatePath === callbackPath
    );
  } catch {
    return false;
  }
};

export const isStaleAuth0CallbackError = (error: unknown): boolean =>
  error instanceof Error && error.message === "Invalid state";
