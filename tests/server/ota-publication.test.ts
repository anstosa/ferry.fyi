import { afterEach, describe, expect, it, vi } from "vitest";

import { getOtaUpdateManifest } from "../../server/lib/ota";
import {
  createOtaReleaseVersion,
  prepareOtaReleaseIndex,
} from "../../server/scripts/prepareOtaRelease";

const SOURCE_SHA = "b".repeat(40);
const CHECKSUM = "c".repeat(64);

// bind each test bundle to its version, source and contents
const release = (
  version: string,
  source = SOURCE_SHA,
  checksum = CHECKSUM
) => ({
  channel: "production",
  checksum,
  url: `https://updates.example.com/bundles/${version}/ferry-fyi-${version}-${source}-${checksum}.zip`,
  version,
});

describe("OTA publication", () => {
  // restore mocked network and configuration
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // retain the latest native prefix while advancing source revisions
  it("derives stable increasing bundle versions from the published app version", () => {
    expect(createOtaReleaseVersion("3.6", 100)).toBe("3.6.100");
    expect(createOtaReleaseVersion("3.6", 100)).toBe("3.6.100");
    expect(createOtaReleaseVersion("3.6", 101)).toBe("3.6.101");
    expect(createOtaReleaseVersion("3.7", 101)).toBe("3.7.101");
  });

  // reject incomplete or unrepresentable source numbering
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid source counts: %s",
    (count) => {
      expect(() => createOtaReleaseVersion("3.6", count)).toThrow();
    }
  );

  // require an unambiguous two-component published app prefix
  it.each([
    "3",
    "03.6",
    "3.06",
    "3.6.0",
    "3.6-beta",
    "3.6+source",
    "x.y",
    "9007199254740992.6",
  ])("rejects invalid published app versions: %s", (version) => {
    expect(() => createOtaReleaseVersion(version, 100)).toThrow();
  });

  // protect unrelated channels and caller-owned index data
  it("updates only the selected channel without mutating the existing index", () => {
    const previous = release("2.5.1", "a".repeat(40));
    const staging = { ...release("2.5.99"), channel: "staging" };
    const current = { releases: [previous, staging] };
    const next = release("2.5.101");

    expect(prepareOtaReleaseIndex(current, next, SOURCE_SHA)).toEqual({
      releases: [staging, next],
    });
    expect(current).toEqual({ releases: [previous, staging] });
  });

  // preserve an exact immutable retry without accepting changed bundle bytes
  it("retains an exact retry and rejects changed bytes under the same source and version", () => {
    const previous = release("2.5.101", SOURCE_SHA, "d".repeat(64));
    const current = { releases: [previous] };

    expect(() =>
      prepareOtaReleaseIndex(current, release("2.5.101"), SOURCE_SHA)
    ).toThrow();
    expect(prepareOtaReleaseIndex(current, previous, SOURCE_SHA)).toEqual(
      current
    );
  });

  // stop stale deployments from replacing newer or equal channel versions
  it.each(["2.5.100", "2.5.101"])(
    "rejects version reuse or regression from another source: %s",
    (version) => {
      expect(() =>
        prepareOtaReleaseIndex(
          { releases: [release("2.5.101", "a".repeat(40))] },
          release(version),
          SOURCE_SHA
        )
      ).toThrow();
    }
  );

  // prevent retry detection from trusting an unrelated bundle origin
  it("rejects an equal-version pointer from another origin", () => {
    const previous = release("2.5.101");
    previous.url = previous.url.replace(
      "updates.example.com",
      "other.example.com"
    );
    expect(() =>
      prepareOtaReleaseIndex(
        { releases: [previous] },
        release("2.5.101"),
        SOURCE_SHA
      )
    ).toThrow();
  });

  // reject corrupt existing indexes instead of silently discarding channels
  it.each([
    null,
    {},
    { releases: [release("2.5.1"), release("2.5.1")] },
    { releases: [{ ...release("2.5.1"), checksum: "invalid" }] },
  ])("rejects an invalid existing index: %j", (current) => {
    expect(() =>
      prepareOtaReleaseIndex(current, release("2.5.101"), SOURCE_SHA)
    ).toThrow();
  });

  // bind publisher metadata to the exact source and immutable object key
  it.each([
    { ...release("2.5.101"), channel: "unknown" },
    { ...release("2.5.101"), checksum: "invalid" },
    { ...release("2.5.101"), url: "https://updates.example.com/unbound.zip" },
    release("2.5.101", "a".repeat(40)),
  ])("rejects invalid candidate metadata: %j", (candidate) => {
    expect(() =>
      prepareOtaReleaseIndex({ releases: [] }, candidate, SOURCE_SHA)
    ).toThrow();
  });

  // accept the initial release while enforcing source identity
  it("supports a first publication and rejects a malformed source SHA", () => {
    const candidate = release("2.5.101");
    expect(
      prepareOtaReleaseIndex({ releases: [] }, candidate, SOURCE_SHA)
    ).toEqual({ releases: [candidate] });
    expect(() =>
      prepareOtaReleaseIndex({ releases: [] }, candidate, "invalid")
    ).toThrow();
  });

  // prove devices stuck on the reused bundle receive the generated version
  it.each(["android", "ios"])(
    "offers the source-versioned release to an installed 2.5.1 %s bundle",
    async (platform) => {
      const candidate = release(createOtaReleaseVersion("3.6", 100));
      const index = prepareOtaReleaseIndex(
        { releases: [release("2.5.1", "a".repeat(40))] },
        candidate,
        SOURCE_SHA
      );
      vi.stubEnv("OTA_RELEASES_BUCKET", "");
      vi.stubEnv(
        "OTA_RELEASES_URL",
        `https://updates.example.com/publication-${platform}.json`
      );
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify(index)))
      );
      const request = {
        app_id: "fyi.ferry",
        device_id: "publication-regression",
        is_emulator: false,
        is_prod: true,
        platform,
        plugin_version: "8.50.2",
        version_build: "3.7",
        version_code: "370",
        version_name: "2.5.1",
        version_os: "15",
        defaultChannel: "production",
      };

      await expect(getOtaUpdateManifest(request)).resolves.toEqual(candidate);
      await expect(
        getOtaUpdateManifest({ ...request, version_name: candidate.version })
      ).resolves.toMatchObject({ kind: "up_to_date" });
    }
  );
});
