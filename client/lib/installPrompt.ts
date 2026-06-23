interface InstallPromptChoice {
  outcome: "accepted" | "dismissed";
  platform: string;
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice?: Promise<InstallPromptChoice>;
}

type InstallPromptListener = () => void;

let installPromptEvent: InstallPromptEvent | null = null;
const installPromptListeners = new Set<InstallPromptListener>();

// notify listeners
const notifyInstallPromptListeners = (): void => {
  installPromptListeners.forEach((listener) => listener());
};

// store install prompt
const handleBeforeInstallPrompt = (event: Event): void => {
  event.preventDefault();
  installPromptEvent = event as InstallPromptEvent;
  notifyInstallPromptListeners();
};

// clear installed prompt
const handleAppInstalled = (): void => {
  installPromptEvent = null;
  notifyInstallPromptListeners();
};

// browser listener guard
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  window.addEventListener("appinstalled", handleAppInstalled);
}

// read prompt availability
export const hasInstallPrompt = (): boolean => Boolean(installPromptEvent);

// subscribe to prompt changes
export const subscribeInstallPrompt = (
  listener: InstallPromptListener
): (() => void) => {
  installPromptListeners.add(listener);
  return () => {
    installPromptListeners.delete(listener);
  };
};

// trigger native prompt
export const triggerInstallPrompt = async (): Promise<boolean> => {
  const promptEvent = installPromptEvent;
  // missing prompt guard
  if (!promptEvent) {
    return false;
  }
  installPromptEvent = null;
  notifyInstallPromptListeners();
  await promptEvent.prompt();
  await promptEvent.userChoice?.catch(() => undefined);
  return true;
};
