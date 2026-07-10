import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => ({
  // retain command inputs for assertions
  GetObjectCommand: class {
    input: unknown;

    // retain the S3 request
    constructor(input: unknown) {
      this.input = input;
    }
  },
  // provide a stable client mock
  S3Client: class {
    // forward reads to the test mock
    send = sendMock;
  },
}));

import { apiRouter } from "../../server/controllers/api";
import { getCachedOtaReleases } from "../../server/lib/ota";

const RELEASE = {
  channel: "production",
  checksum: "a".repeat(64),
  url: "https://updates.example.com/ferry-fyi-2.0.0.zip",
  version: "2.0.0",
};

const VALID_REQUEST = {
  app_id: "fyi.ferry",
  device_id: "device-id",
  is_emulator: false,
  is_prod: true,
  platform: "android",
  plugin_version: "8.50.2",
  version_build: "200",
  version_code: "200",
  version_name: "1.0.0",
  version_os: "14",
};

let urlIndex = 0;

// create an isolated release-index URL
const configureReleaseIndex = (): string => {
  urlIndex += 1;
  const releasesUrl = `https://updates.example.com/releases-${urlIndex}.json`;
  process.env.OTA_RELEASES_URL = releasesUrl;
  return releasesUrl;
};

// create a manifest-compatible API app
const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api", apiRouter);
  return app;
};

// create an index response
const releaseIndexResponse = (releases = [RELEASE]): Response => {
  return new Response(JSON.stringify({ releases }), { status: 200 });
};

describe("OTA release index", () => {
  // isolate environment and network state
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.OTA_DEFAULT_CHANNEL;
    delete process.env.OTA_RELEASES_BUCKET;
    delete process.env.OTA_RELEASES_URL;
    sendMock.mockReset();
  });

  // restore process state
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OTA_DEFAULT_CHANNEL;
    delete process.env.OTA_RELEASES_BUCKET;
    delete process.env.OTA_RELEASES_URL;
  });

  // parse and cache valid immutable releases
  it("validates a release index and caches it for its configured URL", async () => {
    const releasesUrl = configureReleaseIndex();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(releaseIndexResponse());

    await expect(getCachedOtaReleases()).resolves.toEqual([RELEASE]);
    await expect(getCachedOtaReleases()).resolves.toEqual([RELEASE]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(releasesUrl, {
      headers: { Accept: "application/json" },
    });
  });

  // load the private index through the task role when configured
  it("loads the release index from the configured private S3 bucket", async () => {
    process.env.OTA_RELEASES_BUCKET = "private-ota-bucket";
    const transformToString = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ releases: [RELEASE] }));
    sendMock.mockResolvedValue({ Body: { transformToString } });

    await expect(getCachedOtaReleases()).resolves.toEqual([RELEASE]);

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { Bucket: "private-ota-bucket", Key: "releases.json" },
      })
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  // reject malformed index records before caching
  it("rejects malformed release indexes", async () => {
    configureReleaseIndex();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      releaseIndexResponse([{ ...RELEASE, checksum: "not-a-checksum" }])
    );

    await expect(getCachedOtaReleases()).rejects.toThrow(
      "OTA release index is invalid"
    );
  });
});

describe("OTA manifest API", () => {
  // isolate environment and network state
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.OTA_DEFAULT_CHANNEL;
    delete process.env.OTA_RELEASES_URL;
  });

  // restore process state
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OTA_DEFAULT_CHANNEL;
    delete process.env.OTA_RELEASES_URL;
  });

  // return a selected newer Android release without an API envelope
  it("returns a newer release for the requested configured channel", async () => {
    configureReleaseIndex();
    vi.mocked(fetch).mockResolvedValue(releaseIndexResponse());

    const response = await request(createApp())
      .post("/api/ota/manifest")
      .send({ ...VALID_REQUEST, defaultChannel: "production" })
      .expect(200);

    expect(response.body).toEqual(RELEASE);
  });

  // fall back to the server-configured channel
  it("uses OTA_DEFAULT_CHANNEL when the request has no channel", async () => {
    configureReleaseIndex();
    process.env.OTA_DEFAULT_CHANNEL = "production";
    vi.mocked(fetch).mockResolvedValue(releaseIndexResponse());

    const response = await request(createApp())
      .post("/api/ota/manifest")
      .send(VALID_REQUEST)
      .expect(200);

    expect(response.body).toEqual(RELEASE);
  });

  // retain the current bundle for malformed or unsupported requests
  it("returns a safe no-update manifest for non-Android requests", async () => {
    const response = await request(createApp())
      .post("/api/ota/manifest")
      .send({ ...VALID_REQUEST, platform: "ios" })
      .expect(200);

    expect(response.body).toEqual({
      error: "no_new_version_available",
      kind: "up_to_date",
      message: "No new version available",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  // hide upstream and configuration failures from devices
  it("returns a safe no-update manifest when the index cannot be loaded", async () => {
    configureReleaseIndex();
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));

    const response = await request(createApp())
      .post("/api/ota/manifest")
      .send({ ...VALID_REQUEST, defaultChannel: "production" })
      .expect(200);

    expect(response.body).toEqual({
      error: "no_new_version_available",
      kind: "up_to_date",
      message: "No new version available",
    });
  });

  // retain the current bundle when a release is not newer
  it("returns a safe no-update manifest when the release is not newer", async () => {
    configureReleaseIndex();
    vi.mocked(fetch).mockResolvedValue(
      releaseIndexResponse([{ ...RELEASE, version: "1.0.0" }])
    );

    const response = await request(createApp())
      .post("/api/ota/manifest")
      .send({ ...VALID_REQUEST, defaultChannel: "production" })
      .expect(200);

    expect(response.body).toEqual({
      error: "no_new_version_available",
      kind: "up_to_date",
      message: "No new version available",
    });
  });

  // stable releases supersede matching prerelease builds
  it("returns a stable release for a matching prerelease build", async () => {
    configureReleaseIndex();
    vi.mocked(fetch).mockResolvedValue(
      releaseIndexResponse([{ ...RELEASE, version: "1.0.0" }])
    );

    const response = await request(createApp())
      .post("/api/ota/manifest")
      .send({
        ...VALID_REQUEST,
        defaultChannel: "production",
        version_name: "1.0.0-rc.1",
      })
      .expect(200);

    expect(response.body).toEqual({ ...RELEASE, version: "1.0.0" });
  });
});
