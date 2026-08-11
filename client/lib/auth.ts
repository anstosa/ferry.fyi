import type {
  Auth0ContextInterface,
  LogoutOptions,
  PopupLoginOptions,
  RedirectLoginOptions,
} from "@auth0/auth0-react";

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

// ios callback fallback
export const getIosAuthFailurePath = (
  error: unknown,
  platform?: string
): "/login" | undefined =>
  platform === "ios" && !isStaleAuth0CallbackError(error)
    ? "/login"
    : undefined;

type InteractiveLoginMethods = Pick<
  Auth0ContextInterface,
  "loginWithPopup" | "loginWithRedirect"
>;

type LoginWithAppFlowOptions = InteractiveLoginMethods & {
  environment?: string;
  framed?: boolean;
  options?: RedirectLoginOptions;
  popupRedirectUri?: string;
};

type LogoutWithAppFlowOptions = {
  beforeLogout?: () => void;
  framed?: boolean;
  logout: (options?: LogoutOptions) => Promise<void>;
  options?: LogoutOptions;
};

export type LogoutWithAppFlowResult = "local" | "redirecting";
export type LogoutMode = "iframe" | "native" | "web";

// framed browser guard
export const isWindowFramed = (): boolean => {
  // server render guard
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.self !== window.top;
  } catch {
    // cross-origin fallback
    return true;
  }
};

// logout route selector
export const getLogoutMode = (
  isNativeMobile: boolean,
  framed = isWindowFramed()
): LogoutMode => {
  // iframe precedence guard
  if (framed) {
    return "iframe";
  }
  // native browser guard
  if (isNativeMobile) {
    return "native";
  }
  return "web";
};

// popup option adapter
const getPopupLoginOptions = (
  options?: RedirectLoginOptions,
  popupRedirectUri?: string,
  forceLogin = false
): PopupLoginOptions | undefined => {
  // empty option guard
  if (!options?.authorizationParams && !popupRedirectUri && !forceLogin) {
    return undefined;
  }
  return {
    authorizationParams: {
      ...options?.authorizationParams,
      ...(popupRedirectUri ? { redirect_uri: popupRedirectUri } : {}),
      ...(forceLogin && !options?.authorizationParams?.prompt
        ? { prompt: "login" }
        : {}),
    },
  };
};

// environment-aware login route
export const loginWithAppFlow = async ({
  environment = import.meta.env.MODE,
  framed = isWindowFramed(),
  loginWithPopup,
  loginWithRedirect,
  options,
  popupRedirectUri = process.env.AUTH0_DEV_POPUP_REDIRECT,
}: LoginWithAppFlowOptions): Promise<void> => {
  // development iframe guard
  if (environment === "development" && framed) {
    await loginWithPopup(getPopupLoginOptions(options, popupRedirectUri, true));
    return;
  }
  await loginWithRedirect(options);
};

// frame-aware logout route
export const logoutWithAppFlow = async ({
  beforeLogout,
  framed = isWindowFramed(),
  logout,
  options,
}: LogoutWithAppFlowOptions): Promise<LogoutWithAppFlowResult> => {
  // iframe redirect guard
  if (framed) {
    beforeLogout?.();
    await logout({
      ...options,
      openUrl: false,
    });
    return "local";
  }
  await logout(options);
  return "redirecting";
};
