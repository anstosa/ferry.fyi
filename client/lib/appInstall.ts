export type InstallPlatform = "android" | "ios" | "web";

export const GOOGLE_PLAY_URL =
  "https://play.google.com/store/apps/details?id=fyi.ferry";

export const APPLE_APP_STORE_ID = "6790176506";
export const APPLE_APP_STORE_URL = `https://apps.apple.com/us/app/ferry-fyi/id${APPLE_APP_STORE_ID}`;

const INSTALL_PROMPT_REQUEST_EVENT = "ferry-fyi:request-install-prompt";

// identify the browser platform for install guidance
export const getInstallPlatform = (userAgent: string): InstallPlatform => {
  if (/android/i.test(userAgent)) {
    return "android";
  }
  if (/iPad|iPhone|iPod/i.test(userAgent)) {
    return "ios";
  }
  return "web";
};

// read the browser platform when rendering in a browser
export const getBrowserInstallPlatform = (): InstallPlatform => {
  if (typeof navigator === "undefined") {
    return "web";
  }
  return getInstallPlatform(navigator.userAgent);
};

// request that the global install prompt becomes visible again
export const requestInstallPrompt = (): void => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(INSTALL_PROMPT_REQUEST_EVENT));
  }
};

// subscribe to install-prompt requests from other UI surfaces
export const subscribeInstallPromptRequests = (
  listener: () => void
): (() => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  window.addEventListener(INSTALL_PROMPT_REQUEST_EVENT, listener);
  return () =>
    window.removeEventListener(INSTALL_PROMPT_REQUEST_EVENT, listener);
};
