import { afterEach, describe, expect, it, vi } from "vitest";

const capacitor = vi.hoisted(() => ({ isNativePlatform: vi.fn() }));
const errorReporting = vi.hoisted(() => ({
  captureReportedException: vi.fn(),
}));
const workbox = vi.hoisted(() => ({ Workbox: vi.fn() }));

vi.mock("@capacitor/core", () => ({ Capacitor: capacitor }));
vi.mock("~/lib/errorReporting", () => errorReporting);
vi.mock("workbox-window", () => workbox);

describe("service worker runtime setup", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("removes the production load listener when cleaned up before load", async () => {
    vi.stubEnv("NODE_ENV", "production");
    capacitor.isNativePlatform.mockReturnValue(false);
    const listeners = new Map<string, EventListener>();
    const addEventListener = vi.fn((event: string, listener: EventListener) => {
      listeners.set(event, listener);
    });
    const removeEventListener = vi.fn(
      (event: string, listener: EventListener) => {
        expect(listeners.get(event)).toBe(listener);
        listeners.delete(event);
      }
    );
    vi.stubGlobal("window", {
      addEventListener,
      location: { reload: vi.fn() },
      removeEventListener,
    });
    vi.stubGlobal("document", { readyState: "loading" });
    vi.stubGlobal("navigator", { serviceWorker: {} });

    const { initializeServiceWorker } = await import("../../client/lib/worker");
    const cleanup = initializeServiceWorker();

    expect(addEventListener).toHaveBeenCalledWith(
      "load",
      expect.any(Function),
      { once: true }
    );
    cleanup();
    expect(removeEventListener).toHaveBeenCalledWith(
      "load",
      addEventListener.mock.calls[0][1]
    );
    expect(listeners.has("load")).toBe(false);
  });

  it("registers automatically when the browser phase initializes after load", async () => {
    vi.stubEnv("NODE_ENV", "production");
    capacitor.isNativePlatform.mockReturnValue(false);
    const registration = { scope: "https://ferry.fyi/" };
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const addWorkboxEventListener = vi.fn();
    const register = vi.fn().mockResolvedValue(registration);
    workbox.Workbox.mockImplementation(
      class {
        addEventListener = addWorkboxEventListener;
        register = register;
      }
    );
    vi.stubGlobal("window", {
      addEventListener,
      location: { reload: vi.fn() },
      removeEventListener,
    });
    vi.stubGlobal("document", { readyState: "complete" });
    vi.stubGlobal("navigator", { serviceWorker: {} });

    const { getRegistration, initializeServiceWorker } =
      await import("../../client/lib/worker");
    const cleanup = initializeServiceWorker();

    expect(workbox.Workbox).toHaveBeenCalledWith("/service-worker.js", {
      type: "classic",
      updateViaCache: "none",
    });
    expect(addWorkboxEventListener).toHaveBeenCalledWith(
      "installed",
      expect.any(Function)
    );
    expect(register).toHaveBeenCalledOnce();
    await expect(getRegistration()).resolves.toBe(registration);
    expect(addEventListener).not.toHaveBeenCalled();

    cleanup();
    expect(removeEventListener).not.toHaveBeenCalled();
  });

  it("registers Vite's module service worker during local development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    capacitor.isNativePlatform.mockReturnValue(false);
    const registration = { scope: "https://dev.ferry.fyi/" };
    const register = vi.fn().mockResolvedValue(registration);
    workbox.Workbox.mockImplementation(
      class {
        addEventListener = vi.fn();
        register = register;
      }
    );
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      location: { reload: vi.fn() },
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", { readyState: "complete" });
    vi.stubGlobal("navigator", { serviceWorker: {} });

    const { getRegistration, initializeServiceWorker } =
      await import("../../client/lib/worker");
    initializeServiceWorker();

    expect(workbox.Workbox).toHaveBeenCalledWith("/dev-sw.js?dev-sw", {
      type: "module",
      updateViaCache: "none",
    });
    expect(register).toHaveBeenCalledOnce();
    await expect(getRegistration()).resolves.toBe(registration);
  });

  it("shares one registration attempt across repeated initialization", async () => {
    vi.stubEnv("NODE_ENV", "production");
    capacitor.isNativePlatform.mockReturnValue(false);
    const registration = { scope: "https://ferry.fyi/" };
    const register = vi.fn().mockResolvedValue(registration);
    workbox.Workbox.mockImplementation(
      class {
        addEventListener = vi.fn();
        register = register;
      }
    );
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      location: { reload: vi.fn() },
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", { readyState: "complete" });
    vi.stubGlobal("navigator", { serviceWorker: {} });

    const { getRegistration, initializeServiceWorker } =
      await import("../../client/lib/worker");
    initializeServiceWorker();
    initializeServiceWorker();

    expect(register).toHaveBeenCalledOnce();
    await expect(getRegistration()).resolves.toBe(registration);
  });

  // report native cleanup lookup rejection
  it("reports native service-worker lookup failures", async () => {
    capacitor.isNativePlatform.mockReturnValue(true);
    const error = new Error("native service workers unavailable");
    const getRegistrations = vi.fn().mockRejectedValue(error);
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      location: { reload: vi.fn() },
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", { readyState: "complete" });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistrations } });

    const { initializeServiceWorker } = await import("../../client/lib/worker");
    initializeServiceWorker();

    expect(workbox.Workbox).not.toHaveBeenCalled();
    expect(getRegistrations).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(errorReporting.captureReportedException).toHaveBeenCalledWith(
        error
      )
    );
  });

  // report one rejected native unregister
  it("unregisters every native worker and reports individual failures", async () => {
    capacitor.isNativePlatform.mockReturnValue(true);
    const error = new Error("stale worker remained active");
    const firstUnregister = vi.fn().mockResolvedValue(true);
    const secondUnregister = vi.fn().mockRejectedValue(error);
    const getRegistrations = vi
      .fn()
      .mockResolvedValue([
        { unregister: firstUnregister },
        { unregister: secondUnregister },
      ]);
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      location: { reload: vi.fn() },
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", { readyState: "complete" });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistrations } });

    const { initializeServiceWorker } = await import("../../client/lib/worker");
    initializeServiceWorker();

    await vi.waitFor(() => {
      expect(firstUnregister).toHaveBeenCalledOnce();
      expect(secondUnregister).toHaveBeenCalledOnce();
    });
    expect(errorReporting.captureReportedException).toHaveBeenCalledWith(error);
  });
});
