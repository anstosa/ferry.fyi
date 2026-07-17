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
