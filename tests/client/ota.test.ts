import { describe, expect, it, vi } from "vitest";

import { initializeOtaUpdater } from "../../client/lib/ota";

const environment = {
  VITE_OTA_CHANNEL: "production",
  VITE_OTA_MANIFEST_URL: "https://ferry.fyi/api/ota/manifest",
};

// create an isolated native updater mock
const createUpdater = () => ({
  download: vi.fn().mockResolvedValue({ id: "bundle-2", version: "2.5.1" }),
  getLatest: vi.fn().mockResolvedValue({
    checksum: "checksum",
    url: "https://cdn.ferry.fyi/2.5.1.zip",
    version: "2.5.1",
  }),
  getNextBundle: vi.fn().mockResolvedValue(null),
  next: vi.fn().mockResolvedValue(undefined),
  notifyAppReady: vi.fn().mockResolvedValue(undefined),
  setUpdateUrl: vi.fn().mockResolvedValue(undefined),
});

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
  });

  it("acknowledges the active bundle and stages a newer update", async () => {
    const updater = createUpdater();

    const result = await initializeOtaUpdater({
      environment,
      isNativePlatform: () => true,
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
  });

  it("keeps an already queued matching bundle", async () => {
    const updater = createUpdater();
    updater.getNextBundle.mockResolvedValue({
      id: "bundle-2",
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
