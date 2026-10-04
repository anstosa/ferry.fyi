import { describe, expect, it, vi } from "vitest";

import {
  createAwsWifTokenProvider,
  createSignedGetCallerIdentitySubjectToken,
} from "../../server/lib/googleCloud/awsWif";

const PROVIDER =
  "//iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/ferry-pool/providers/aws-prod";

const OFFICIAL_EXAMPLE_CREDENTIALS = {
  accessKeyId: "AKIDEXAMPLE",
  expiration: "2030-01-01T00:00:00Z",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  token: "session-token",
};

/** Creates a JSON fetch response. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

describe("Google AWS WIF", () => {
  // stalled credentials or exchanges must release the renewable export lease
  it.each(["metadata", "exchange"])(
    "bounds a stalled %s request",
    async (stage) => {
      vi.useFakeTimers();
      const fetchImpl = vi.fn(async (_url, options?: RequestInit) => {
        // allow metadata through when exercising a stalled token exchange
        if (stage === "exchange" && fetchImpl.mock.calls.length === 1) {
          return jsonResponse({
            AccessKeyId: "runtime-access",
            Expiration: "2030-01-01T00:00:00Z",
            SecretAccessKey: "runtime-secret",
            Token: "runtime-token",
          });
        }
        return new Promise<Response>((_resolve, reject) => {
          // emulate fetch cancellation without contacting either provider
          options?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true }
          );
        });
      });
      try {
        const provider = createAwsWifTokenProvider(
          { awsRegion: "us-west-2", providerResource: PROVIDER },
          {
            env: {
              AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc-123",
            },
            fetchImpl: fetchImpl as typeof fetch,
          }
        );
        const outcome = expect(provider.getAccessToken()).rejects.toThrow(
          "aborted"
        );
        await vi.advanceTimersByTimeAsync(10_000);
        await outcome;
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    }
  );

  // keep metadata and exchange body parsing inside their request deadlines
  it.each(["metadata", "exchange"])(
    "bounds a stalled %s response body",
    async (stage) => {
      vi.useFakeTimers();
      const fetchImpl = vi.fn((_url, options?: RequestInit) => {
        // allow metadata through when exercising a stalled exchange body
        if (stage === "exchange" && fetchImpl.mock.calls.length === 1) {
          return Promise.resolve(
            jsonResponse({
              AccessKeyId: "runtime-access",
              Expiration: "2030-01-01T00:00:00Z",
              SecretAccessKey: "runtime-secret",
              Token: "runtime-token",
            })
          );
        }
        return Promise.resolve({
          json: () =>
            new Promise((_resolve, reject) => {
              // emulate an unread response body until the request is aborted
              options?.signal?.addEventListener(
                "abort",
                () => reject(new Error("aborted body")),
                { once: true }
              );
            }),
          ok: true,
        } as Response);
      });
      try {
        const provider = createAwsWifTokenProvider(
          { awsRegion: "us-west-2", providerResource: PROVIDER },
          {
            env: {
              AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc-123",
            },
            fetchImpl: fetchImpl as typeof fetch,
          }
        );
        const outcome = expect(provider.getAccessToken()).rejects.toThrow(
          "aborted body"
        );
        await vi.advanceTimersByTimeAsync(10_000);
        await outcome;
        expect(fetchImpl).toHaveBeenCalledTimes(stage === "metadata" ? 1 : 2);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    }
  );

  // pin the AWS official-example credential vector through the STS signer
  it("produces a deterministic SigV4 GetCallerIdentity request", () => {
    const token = createSignedGetCallerIdentitySubjectToken({
      credentials: OFFICIAL_EXAMPLE_CREDENTIALS,
      now: new Date("2015-08-30T12:36:00.000Z"),
      providerResource: PROVIDER,
      region: "us-east-1",
    });

    expect(token).toMatchObject({
      method: "POST",
      url: "https://sts.us-east-1.amazonaws.com?Action=GetCallerIdentity&Version=2011-06-15",
    });
    expect(token.headers).toContainEqual({
      key: "Authorization",
      value:
        "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/sts/aws4_request, SignedHeaders=host;x-amz-date;x-amz-security-token;x-goog-cloud-target-resource, Signature=a0c9135db497274c4acdbc40ce54cb7fef80b72f2da7d5fc1d5c1e18efe2bb59",
    });
    expect(token.headers).toContainEqual({
      key: "x-goog-cloud-target-resource",
      value: PROVIDER,
    });
  });

  // reject arbitrary credential hosts before making any request
  it("rejects absolute ECS credential URIs", async () => {
    const fetchImpl = vi.fn();
    const provider = createAwsWifTokenProvider(
      { awsRegion: "us-west-2", providerResource: PROVIDER },
      {
        env: {
          AWS_CONTAINER_CREDENTIALS_RELATIVE_URI:
            "http://attacker.invalid/credentials",
        },
        fetchImpl: fetchImpl as typeof fetch,
      }
    );

    await expect(provider.getAccessToken()).rejects.toThrow(
      "Invalid ECS credentials relative URI"
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // use the fixed metadata and Google STS hosts and cache the short-lived token
  it("exchanges ECS credentials once and caches a healthy token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          AccessKeyId: "runtime-access",
          Expiration: "2026-10-03T02:00:00Z",
          SecretAccessKey: "runtime-secret",
          Token: "runtime-token",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "google-token", expires_in: 3_600 })
      );
    const provider = createAwsWifTokenProvider(
      { awsRegion: "us-west-2", providerResource: PROVIDER },
      {
        env: {
          AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc-123",
        },
        fetchImpl: fetchImpl as typeof fetch,
        now: () => new Date("2026-10-03T01:00:00Z"),
      }
    );

    await expect(provider.getAccessToken()).resolves.toBe("google-token");
    await expect(provider.getAccessToken()).resolves.toBe("google-token");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "http://169.254.170.2/v2/credentials/abc-123"
    );
    expect(fetchImpl.mock.calls[1][0]).toBe(
      "https://sts.googleapis.com/v1/token"
    );
    const body = fetchImpl.mock.calls[1][1]?.body as URLSearchParams;
    expect(body.get("scope")).toBe(
      "https://www.googleapis.com/auth/monitoring.write"
    );
    expect(decodeURIComponent(String(body.get("subject_token")))).toContain(
      "x-goog-cloud-target-resource"
    );
  });
});
