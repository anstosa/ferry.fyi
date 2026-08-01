// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  installArrayAtPolyfill,
  installObjectHasOwnPolyfill,
  installPreloadRecovery,
} from "../../client/lib/runtimeRecovery";

describe("client runtime recovery", () => {
  it("reloads once when a deployed lazy chunk is no longer available", () => {
    const listeners: EventListener[] = [];
    const reload = vi.fn();
    const storage = new Map<string, string>();
    installPreloadRecovery({
      build: "v42",
      location: { pathname: "/tickets", reload, search: "" },
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
      target: {
        addEventListener: (_type, listener) =>
          listeners.push(listener as EventListener),
      },
    });
    const event = new Event("vite:preloadError", { cancelable: true });

    listeners[0](event);
    listeners[0](new Event("vite:preloadError", { cancelable: true }));

    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not suppress the preload error when recovery state is unavailable", () => {
    let listener: EventListener | undefined;
    const reload = vi.fn();
    installPreloadRecovery({
      location: { pathname: "/tickets", reload, search: "" },
      storage: {
        getItem: () => {
          throw new Error("storage blocked");
        },
        setItem: vi.fn(),
      },
      target: {
        addEventListener: (_type, nextListener) => {
          listener = nextListener as EventListener;
        },
      },
    });
    const event = new Event("vite:preloadError", { cancelable: true });

    listener?.(event);

    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("polyfills Object.hasOwn for older Android WebViews", () => {
    const original = Object.hasOwn;
    Object.hasOwn = undefined as never;
    try {
      installObjectHasOwnPolyfill();
      expect(Object.hasOwn({ ferry: true }, "ferry")).toBe(true);
      expect(Object.hasOwn(Object.create({ ferry: true }), "ferry")).toBe(
        false
      );
    } finally {
      Object.hasOwn = original;
    }
  });

  it("polyfills Array.at for older Android WebViews", () => {
    const original = Array.prototype.at;
    Array.prototype.at = undefined as never;
    try {
      installArrayAtPolyfill();
      expect(["first", "last"].at(-1)).toBe("last");
      expect(["first"].at(2)).toBeUndefined();
    } finally {
      Array.prototype.at = original;
    }
  });
});
