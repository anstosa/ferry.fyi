import { Capacitor } from "@capacitor/core";

type Auth0RedirectUriOptions = {
  domain: string;
  platform?: string;
  redirectUri: string;
};

export const getAuth0RedirectUri = ({
  domain,
  platform = Capacitor.getPlatform(),
  redirectUri,
}: Auth0RedirectUriOptions): string => {
  if (platform === "android") {
    return `fyi.ferry://${domain}/capacitor/fyi.ferry/callback`;
  }

  return redirectUri;
};

export const getConfiguredAuth0RedirectUri = (): string =>
  getAuth0RedirectUri({
    domain: process.env.AUTH0_DOMAIN as string,
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
