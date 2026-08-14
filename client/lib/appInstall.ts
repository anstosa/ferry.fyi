export type InstallPlatform = "android" | "ios" | "web";

export const GOOGLE_PLAY_URL =
  "https://play.google.com/store/apps/details?id=fyi.ferry";

export const APPLE_APP_STORE_ID = "6790176506";
export const APPLE_APP_STORE_URL = `https://apps.apple.com/us/app/ferry-fyi/id${APPLE_APP_STORE_ID}`;

const INSTALL_PROMPT_REQUEST_EVENT = "ferry-fyi:request-install-prompt";

// identify the browser platform for install guidance
export const getInstallPlatform = (
  userAgent: string,
  maxTouchPoints = 0
): InstallPlatform => {
  // android store routing
  if (/android/i.test(userAgent)) {
    return "android";
  }
  // apple store routing
  if (
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)
  ) {
    return "ios";
  }
  return "web";
};

// resolve the native store for a browser platform
export const getInstallStoreUrl = (
  platform: InstallPlatform
): string | null => {
  // google play routing
  if (platform === "android") {
    return GOOGLE_PLAY_URL;
  }
  // app store routing
  if (platform === "ios") {
    return APPLE_APP_STORE_URL;
  }
  return null;
};

// redirect mobile browsers to their native store
export const redirectToInstallStore = (
  platform: InstallPlatform,
  redirect: (url: string) => void = (url) => window.location.replace(url)
): boolean => {
  const url = getInstallStoreUrl(platform);
  // desktop PWA guard
  if (!url) {
    return false;
  }
  redirect(url);
  return true;
};

// read the browser platform when rendering in a browser
export const getBrowserInstallPlatform = (): InstallPlatform => {
  // server rendering fallback
  if (typeof navigator === "undefined") {
    return "web";
  }
  return getInstallPlatform(navigator.userAgent, navigator.maxTouchPoints);
};

// request that the global install prompt becomes visible again
export const requestInstallPrompt = (): void => {
  // browser event guard
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(INSTALL_PROMPT_REQUEST_EVENT));
  }
};

// subscribe to install-prompt requests from other UI surfaces
export const subscribeInstallPromptRequests = (
  listener: () => void
): (() => void) => {
  // server rendering fallback
  if (typeof window === "undefined") {
    return () => undefined;
  }
  window.addEventListener(INSTALL_PROMPT_REQUEST_EVENT, listener);
  return () =>
    window.removeEventListener(INSTALL_PROMPT_REQUEST_EVENT, listener);
};
