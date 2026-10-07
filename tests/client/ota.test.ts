import { afterEach, describe, expect, it, vi } from "vitest";

import { applyOtaUpdate, initializeOtaUpdater } from "../../client/lib/ota";

const environment = {
  VITE_OTA_CHANNEL: "production",
  VITE_OTA_MANIFEST_URL: "https://ferry.fyi/api/ota/manifest",
};

// create an isolated native updater mock
const createUpdater = () => ({
  addListener: vi
    .fn()
    .mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) }),
  download: vi.fn().mockResolvedValue({ id: "bundle-2", version: "2.5.1" }),
  getLatest: vi.fn().mockResolvedValue({
    checksum: "checksum",
    url: "https://cdn.ferry.fyi/2.5.1.zip",
    version: "2.5.1",
  }),
  getNextBundle: vi.fn().mockResolvedValue(null),
  next: vi.fn().mockResolvedValue(undefined),
  notifyAppReady: vi.fn().mockResolvedValue(undefined),
  reload: vi.fn().mockResolvedValue(undefined),
  setUpdateUrl: vi.fn().mockResolvedValue(undefined),
});

// restore diagnostic spies between cases
afterEach(() => vi.restoreAllMocks());

describe("initializeOtaUpdater", () => {
  it("does not load OTA behavior in a browser", async () => {
    const updater = createUpdater();

    const result = await initializeOtaUpdater({
      environment,
      isNativePlatform: () => false,
      updater,
    });

    expect(result).toBe("native-unavailable");
    expect(updater.notifyAppReady).not.toHaveBeenCalled();
    expect(updater.addListener).not.toHaveBeenCalled();
  });

  it("acknowledges the active bundle and stages a newer update", async () => {
    const updater = createUpdater();
    const onStateChange = vi.fn();

    const result = await initializeOtaUpdater({
      environment,
      isNativePlatform: () => true,
      onStateChange,
      updater,
    });

    expect(result).toBe("queued");
    expect(updater.notifyAppReady).toHaveBeenCalledBefore(updater.setUpdateUrl);
    expect(updater.setUpdateUrl).toHaveBeenCalledWith({
      url: environment.VITE_OTA_MANIFEST_URL,
    });
    expect(updater.getLatest).toHaveBeenCalledWith({ channel: "production" });
    expect(updater.download).toHaveBeenCalledWith({
      checksum: "checksum",
      url: "https://cdn.ferry.fyi/2.5.1.zip",
      version: "2.5.1",
    });
    expect(updater.next).toHaveBeenCalledWith({ id: "bundle-2" });
    expect(onStateChange.mock.calls).toEqual([
      [{ status: "downloading", progress: 0 }],
      [{ status: "ready", bundleId: "bundle-2" }],
    ]);
    expect(updater.reload).not.toHaveBeenCalled();
  });

  it("restores an already queued bundle still offered by the manifest", async () => {
    const updater = createUpdater();
    updater.getNextBundle.mockResolvedValue({
      id: "bundle-2",
      status: "pending",
      version: "2.5.1",
    });
    const onStateChange = vi.fn();

    const result = await initializeOtaUpdater({
      environment,
      isNativePlatform: () => true,
      onStateChange,
      updater,
    });

    expect(result).toBe("queued");
    expect(onStateChange).toHaveBeenCalledWith({
      status: "ready",
      bundleId: "bundle-2",
    });
    expect(updater.getLatest).toHaveBeenCalledWith({ channel: "production" });
    expect(updater.notifyAppReady).toHaveBeenCalledOnce();
    expect(updater.notifyAppReady).toHaveBeenCalledBefore(
      updater.getNextBundle
    );
    expect(updater.download).not.toHaveBeenCalled();
    expect(updater.next).not.toHaveBeenCalled();
  });

  // failed readiness acknowledgement must not bypass native rollback
  it("does not check or stage updates when acknowledging the running bundle fails", async () => {
    // capture the rollback diagnostic without polluting test output
    const diagnostic = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const updater = createUpdater();
    updater.notifyAppReady.mockRejectedValue(new Error("not ready"));
    expect(
      await initializeOtaUpdater({
        environment,
        isNativePlatform: () => true,
        updater,
      })
    ).toBe("failed");
    expect(updater.getNextBundle).not.toHaveBeenCalled();
    expect(updater.download).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith(
      "OTA readiness acknowledgement failed; retaining native rollback protection"
    );
  });

  // channel changes and rollback manifests supersede stale queued versions
  it("downloads the offered version instead of reusing a different queued version", async () => {
    const updater = createUpdater();
    updater.getNextBundle.mockResolvedValue({
      id: "stale",
      status: "pending",
      version: "2.5.0",
    });
    const onStateChange = vi.fn();
    expect(
      await initializeOtaUpdater({
        environment,
        isNativePlatform: () => true,
        onStateChange,
        updater,
      })
    ).toBe("queued");
    expect(updater.download).toHaveBeenCalledOnce();
    expect(onStateChange).not.toHaveBeenCalledWith({
      status: "ready",
      bundleId: "stale",
    });
    expect(onStateChange).toHaveBeenLastCalledWith({
      status: "ready",
      bundleId: "bundle-2",
    });
  });

  // a withdrawn release must not gain an explicit apply action
  it("does not offer a queued bundle when the manifest no longer offers an update", async () => {
    const updater = createUpdater();
    updater.getNextBundle.mockResolvedValue({
      id: "withdrawn",
      status: "pending",
      version: "2.5.1",
    });
    updater.getLatest.mockResolvedValue({
      version: "2.5.1",
      kind: "up_to_date",
    });
    const onStateChange = vi.fn();
    expect(
      await initializeOtaUpdater({
        environment,
        isNativePlatform: () => true,
        onStateChange,
        updater,
      })
    ).toBe("up-to-date");
    expect(onStateChange).not.toHaveBeenCalled();
    expect(updater.reload).not.toHaveBeenCalled();
  });

  // track only the offered bundle and release the native listener
  it("reports native download progress until staging finishes", async () => {
    const updater = createUpdater();
    const remove = vi.fn().mockResolvedValue(undefined);
    updater.addListener.mockResolvedValue({ remove });
    const onStateChange = vi.fn();
    // deliver progress while the real download promise is pending
    updater.download.mockImplementation(async () => {
      const listener = updater.addListener.mock.calls[0][1];
      listener({ percent: 42, bundle: { version: "2.5.1" } });
      listener({ percent: 80, bundle: { version: "other" } });
      listener({ percent: Number.NaN, bundle: { version: "2.5.1" } });
      listener({ percent: 120, bundle: { version: "2.5.1" } });
      return { id: "bundle-2", version: "2.5.1" };
    });

    await initializeOtaUpdater({
      environment,
      isNativePlatform: () => true,
      onStateChange,
      updater,
    });

    expect(updater.addListener).toHaveBeenCalledWith(
      "download",
      expect.any(Function)
    );
    expect(updater.addListener).toHaveBeenCalledBefore(updater.download);
    expect(onStateChange.mock.calls).toEqual([
      [{ status: "downloading", progress: 0 }],
      [{ status: "downloading", progress: 42 }],
      [{ status: "downloading", progress: 100 }],
      [{ status: "ready", bundleId: "bundle-2" }],
    ]);
    expect(updater.next).toHaveBeenCalledBefore(remove);
    expect(remove).toHaveBeenCalledOnce();
    // ignore already dispatched native events after listener retirement
    updater.addListener.mock.calls[0][1]({
      percent: 42,
      bundle: { version: "2.5.1" },
    });
    expect(onStateChange).toHaveBeenLastCalledWith({
      status: "ready",
      bundleId: "bundle-2",
    });
  });

  // do not advertise completion before the native queue accepts the bundle
  it.each(["download", "next"] as const)(
    "reports %s failure and removes its listener",
    async (operation) => {
      const updater = createUpdater();
      const remove = vi.fn().mockResolvedValue(undefined);
      updater.addListener.mockResolvedValue({ remove });
      updater[operation].mockRejectedValue(new Error("unavailable"));
      const onStateChange = vi.fn();

      expect(
        await initializeOtaUpdater({
          environment,
          isNativePlatform: () => true,
          onStateChange,
          updater,
        })
      ).toBe("failed");
      expect(onStateChange).toHaveBeenLastCalledWith({ status: "failed" });
      expect(onStateChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: "ready" })
      );
      expect(remove).toHaveBeenCalledOnce();
    }
  );

  // recover a corrupt queued bundle by downloading a fresh copy
  it("does not reuse a failed queued bundle", async () => {
    const updater = createUpdater();
    updater.getNextBundle.mockResolvedValue({
      id: "old",
      status: "error",
      version: "2.5.1",
    });
    expect(
      await initializeOtaUpdater({
        environment,
        isNativePlatform: () => true,
        updater,
      })
    ).toBe("queued");
    expect(updater.download).toHaveBeenCalledOnce();
  });

  it("does not download Capgo's classified up-to-date response", async () => {
    const updater = createUpdater();
    updater.getLatest.mockResolvedValue({
      kind: "up_to_date",
      message: "No new version available",
      version: "2.5.1",
    });

    const result = await initializeOtaUpdater({
      environment,
      isNativePlatform: () => true,
      updater,
    });

    expect(result).toBe("up-to-date");
    expect(updater.download).not.toHaveBeenCalled();
    expect(updater.next).not.toHaveBeenCalled();
  });

  it("keeps the active bundle when configuration or update checks fail", async () => {
    const updater = createUpdater();
    updater.getLatest.mockRejectedValue(new Error("offline"));

    const failedResult = await initializeOtaUpdater({
      environment,
      isNativePlatform: () => true,
      updater,
    });
    const disabledResult = await initializeOtaUpdater({
      environment: {},
      isNativePlatform: () => true,
      updater: createUpdater(),
    });

    expect(failedResult).toBe("failed");
    expect(disabledResult).toBe("disabled");
  });
});

describe("applyOtaUpdate", () => {
  // use the pending-aware native reload path rather than retaining a stale next pointer
  it("activates and reloads the queued bundle", async () => {
    const updater = createUpdater();
    await applyOtaUpdate(updater);
    expect(updater.reload).toHaveBeenCalledOnce();
  });

  // an applied and acknowledged update must not revive its reload notice
  it("does not offer the applied bundle again after a full reload lifecycle", async () => {
    const updater = createUpdater();
    let activeVersion = "builtin";
    let queued: { id: string; version: string; status: string } | null = null;
    // model the native pending pointer
    updater.getNextBundle.mockImplementation(async () => queued);
    // model the manifest's current-version classification
    updater.getLatest.mockImplementation(async () =>
      activeVersion === "builtin"
        ? { url: "https://cdn.ferry.fyi/2.5.1.zip", version: "2.5.1" }
        : { kind: "up_to_date", version: "2.5.1" }
    );
    // stage the downloaded bundle
    updater.next.mockImplementation(async () => {
      queued = { id: "bundle-2", version: "2.5.1", status: "pending" };
    });
    // native reload consumes the pending pointer
    updater.reload.mockImplementation(async () => {
      activeVersion = queued?.version ?? activeVersion;
      queued = null;
    });
    const onStateChange = vi.fn();
    expect(
      await initializeOtaUpdater({
        environment,
        isNativePlatform: () => true,
        onStateChange,
        updater,
      })
    ).toBe("queued");
    await applyOtaUpdate(updater);
    onStateChange.mockClear();
    expect(
      await initializeOtaUpdater({
        environment,
        isNativePlatform: () => true,
        onStateChange,
        updater,
      })
    ).toBe("up-to-date");
    expect(queued).toBeNull();
    expect(onStateChange).not.toHaveBeenCalled();
    expect(updater.download).toHaveBeenCalledOnce();
    expect(updater.notifyAppReady).toHaveBeenCalledTimes(2);
  });

  // leave activation failures available to the retry UI
  it("propagates activation failures", async () => {
    const updater = createUpdater();
    updater.reload.mockRejectedValue(new Error("cannot activate"));
    await expect(applyOtaUpdate(updater)).rejects.toThrow("cannot activate");
  });
});
