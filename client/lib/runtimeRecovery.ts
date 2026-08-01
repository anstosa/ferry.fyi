const PRELOAD_RECOVERY_STORAGE_KEY = "ferry-fyi:preload-recovery";

interface PreloadRecoveryOptions {
  build?: string;
  location?: Pick<Location, "pathname" | "reload" | "search">;
  storage?: Pick<Storage, "getItem" | "setItem">;
  target?: Pick<Window, "addEventListener">;
}

export const installObjectHasOwnPolyfill = (): void => {
  if (typeof Object.hasOwn === "function") {
    return;
  }
  Object.hasOwn = (object: object, property: PropertyKey): boolean =>
    Object.prototype.hasOwnProperty.call(object, property);
};

export const installArrayAtPolyfill = (): void => {
  if (typeof Array.prototype.at === "function") {
    return;
  }
  // Compatibility boundary for Android WebViews older than Chromium 92.
  // eslint-disable-next-line no-extend-native
  Object.defineProperty(Array.prototype, "at", {
    configurable: true,
    value(this: unknown[], index: number): unknown {
      const integer = Number.isNaN(index) ? 0 : Math.trunc(index);
      const target = integer < 0 ? this.length + integer : integer;
      return target < 0 || target >= this.length ? undefined : this[target];
    },
    writable: true,
  });
};

export const installPreloadRecovery = ({
  build = process.env.HEROKU_RELEASE_VERSION || "development",
  location = window.location,
  storage = window.sessionStorage,
  target = window,
}: PreloadRecoveryOptions = {}): void => {
  target.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    const recovery = `${build}:${location.pathname}${location.search}`;
    try {
      if (storage.getItem(PRELOAD_RECOVERY_STORAGE_KEY) === recovery) {
        return;
      }
      storage.setItem(PRELOAD_RECOVERY_STORAGE_KEY, recovery);
    } catch {
      // Without durable per-tab state, reloading could loop forever.
      return;
    }
    location.reload();
  });
};
