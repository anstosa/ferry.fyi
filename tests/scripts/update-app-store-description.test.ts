// @vitest-environment node

import { Buffer } from "node:buffer";
import { generateKeyPairSync, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createAppStoreConnectToken,
  updateAppStoreDescription,
} from "../../scripts/update-app-store-description.mjs";

/** Builds one JSON API response. */
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

describe("App Store description automation", () => {
  // preserve required supporter disclosure
  it("keeps the canonical description complete and within Apple's limit", async () => {
    const description = (
      await readFile(
        resolve("store-metadata/apple/en-US/description.txt"),
        "utf8"
      )
    ).trim();

    expect([...description].length).toBeLessThanOrEqual(4000);
    expect(description).toContain("Ferry FYI Supporter");
    expect(description).toContain("$2.49 per month or $19.99 per year");
    expect(description).toContain("renews automatically");
    expect(description).toContain("Restore Purchases");
    expect(description).toContain("https://ferry.fyi/terms");
    expect(description).toContain("https://ferry.fyi/privacy");
  });

  // create a standards-compliant api token
  it("signs App Store Connect tokens with ES256", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const token = createAppStoreConnectToken({
      issuerId: "issuer-id",
      keyId: "key-id",
      now: 1_800_000_000,
      privateKey,
    });
    const [header, payload, signature] = token.split(".");

    expect(
      JSON.parse(Buffer.from(header, "base64url").toString("utf8"))
    ).toEqual({
      alg: "ES256",
      kid: "key-id",
      typ: "JWT",
    });
    expect(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    ).toEqual({
      aud: "appstoreconnect-v1",
      exp: 1_800_001_140,
      iat: 1_800_000_000,
      iss: "issuer-id",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { dsaEncoding: "ieee-p1363", key: publicKey },
        Buffer.from(signature, "base64url")
      )
    ).toBe(true);
  });

  // update an existing localization
  it("patches the exact localized version description", async () => {
    const responses = [
      jsonResponse({ data: [{ id: "app-1", type: "apps" }] }),
      jsonResponse({
        data: [{ id: "version-36", type: "appStoreVersions" }],
      }),
      jsonResponse({
        data: [
          {
            id: "localization-en-us",
            type: "appStoreVersionLocalizations",
          },
        ],
      }),
      jsonResponse({
        data: {
          id: "localization-en-us",
          type: "appStoreVersionLocalizations",
        },
      }),
    ];
    // return staged api responses
    const fetchImplementation = vi.fn(() => {
      const response = responses.shift();
      // complete response guard
      if (!response) {
        throw new Error("Unexpected App Store Connect request");
      }
      return response;
    });

    const result = await updateAppStoreDescription({
      bundleId: "fyi.ferry",
      description: "Updated description",
      fetchImplementation,
      locale: "en-US",
      token: "signed-token",
      versionName: "3.6",
    });

    expect(result).toEqual({
      createdLocalization: false,
      createdVersion: false,
      versionId: "version-36",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
    expect(
      decodeURIComponent(String(fetchImplementation.mock.calls[1]?.[0]))
    ).toContain("filter[versionString]=3.6");
    expect(fetchImplementation.mock.calls[3]?.[0]).toBe(
      "https://api.appstoreconnect.apple.com/v1/appStoreVersionLocalizations/localization-en-us"
    );
    expect(fetchImplementation.mock.calls[3]?.[1]).toMatchObject({
      body: JSON.stringify({
        data: {
          attributes: { description: "Updated description" },
          id: "localization-en-us",
          type: "appStoreVersionLocalizations",
        },
      }),
      method: "PATCH",
    });
  });

  // fail closed on a mistyped version
  it("does not create a missing version unless explicitly enabled", async () => {
    const responses = [
      jsonResponse({ data: [{ id: "app-1", type: "apps" }] }),
      jsonResponse({ data: [] }),
    ];
    // return staged api responses
    const fetchImplementation = vi.fn(() => {
      const response = responses.shift();
      // complete response guard
      if (!response) {
        throw new Error("Unexpected App Store Connect request");
      }
      return response;
    });

    await expect(
      updateAppStoreDescription({
        bundleId: "fyi.ferry",
        description: "Updated description",
        fetchImplementation,
        locale: "en-US",
        token: "signed-token",
        versionName: "3.60",
      })
    ).rejects.toThrow(
      "App Store version 3.60 does not exist; create it or enable version creation"
    );
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  // create missing version metadata
  it("creates an explicitly allowed version and localization", async () => {
    const responses = [
      jsonResponse({ data: [{ id: "app-1", type: "apps" }] }),
      jsonResponse({ data: [] }),
      jsonResponse(
        {
          data: { id: "version-36", type: "appStoreVersions" },
        },
        201
      ),
      jsonResponse({ data: [] }),
      jsonResponse(
        {
          data: {
            id: "localization-en-us",
            type: "appStoreVersionLocalizations",
          },
        },
        201
      ),
    ];
    // return staged api responses
    const fetchImplementation = vi.fn(() => {
      const response = responses.shift();
      // complete response guard
      if (!response) {
        throw new Error("Unexpected App Store Connect request");
      }
      return response;
    });

    const result = await updateAppStoreDescription({
      bundleId: "fyi.ferry",
      createVersionIfMissing: true,
      description: "Updated description",
      fetchImplementation,
      locale: "en-US",
      token: "signed-token",
      versionName: "3.6",
    });

    expect(result).toEqual({
      createdLocalization: true,
      createdVersion: true,
      versionId: "version-36",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
    expect(fetchImplementation.mock.calls[2]?.[0]).toBe(
      "https://api.appstoreconnect.apple.com/v1/appStoreVersions"
    );
    expect(fetchImplementation.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
    });
    expect(fetchImplementation.mock.calls[4]?.[0]).toBe(
      "https://api.appstoreconnect.apple.com/v1/appStoreVersionLocalizations"
    );
  });
});
