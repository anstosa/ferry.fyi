import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRevenueCatManagementUrl,
  listRevenueCatSubscriptions,
  parseRevenueCatWebhook,
  verifyRevenueCatWebhook,
} from "../../server/lib/revenueCat";

const NOW = new Date("2026-08-23T12:00:00.000Z");
const TIMESTAMP = Math.floor(NOW.getTime() / 1_000);
const AUTHORIZATION = "Bearer test-webhook-authorization";
const HMAC_SECRET = "test-webhook-hmac-secret";
const APP_USER_ID = "7b16dbdb-d7dd-4eec-9ddf-88dfec7407ea";

// sign one exact webhook body
const signBody = (body: Buffer, timestamp = TIMESTAMP): string => {
  const signature = createHmac("sha256", HMAC_SECRET)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), body]))
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
};

describe("RevenueCat webhook trust boundary", () => {
  beforeEach(() => {
    process.env.REVENUECAT_PRODUCTION_WEBHOOK_AUTHORIZATION = AUTHORIZATION;
    process.env.REVENUECAT_PRODUCTION_WEBHOOK_HMAC_SECRET = HMAC_SECRET;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates authorization and an exact-byte HMAC", () => {
    const body = Buffer.from('{"event":{"id":"event-1"}}');

    expect(
      verifyRevenueCatWebhook({
        authorization: AUTHORIZATION,
        body,
        environment: "production",
        now: NOW,
        signature: signBody(body),
      })
    ).toBe(true);
    expect(
      verifyRevenueCatWebhook({
        authorization: AUTHORIZATION,
        body: Buffer.from(`${body.toString("utf8")} `),
        environment: "production",
        now: NOW,
        signature: signBody(body),
      })
    ).toBe(false);
  });

  it("rejects wrong authorization and replayed signatures", () => {
    const body = Buffer.from('{"event":{"id":"event-1"}}');

    expect(
      verifyRevenueCatWebhook({
        authorization: "Bearer wrong",
        body,
        environment: "production",
        now: NOW,
        signature: signBody(body),
      })
    ).toBe(false);
    expect(
      verifyRevenueCatWebhook({
        authorization: AUTHORIZATION,
        body,
        environment: "production",
        now: NOW,
        signature: signBody(body, TIMESTAMP - 301),
      })
    ).toBe(false);
  });

  it("extracts only custom UUID targets from the bound environment", () => {
    const body = Buffer.from(
      JSON.stringify({
        event: {
          app_id: "app_test_store",
          app_user_id: APP_USER_ID,
          aliases: [
            "5791356b-173e-4463-a4e1-a9ed5f64d5a4",
            "$RCAnonymousID:ignored-alias",
          ],
          environment: "PRODUCTION",
          event_timestamp_ms: NOW.getTime(),
          id: "event-1",
          original_app_user_id: "$RCAnonymousID:ignored",
          transferred_from: [
            "41f9db60-08fa-43ad-8d89-6b9c3fa85603",
            "not-a-uuid",
          ],
          transferred_to: [APP_USER_ID],
          type: "TRANSFER",
        },
      })
    );

    expect(parseRevenueCatWebhook(body, "production")).toEqual({
      appId: "app_test_store",
      appUserIds: [
        "41f9db60-08fa-43ad-8d89-6b9c3fa85603",
        "5791356b-173e-4463-a4e1-a9ed5f64d5a4",
        APP_USER_ID,
      ],
      environment: "production",
      eventId: "event-1",
      eventTimestamp: NOW,
      eventType: "TRANSFER",
    });
    expect(parseRevenueCatWebhook(body, "sandbox")).toBeNull();
  });

  // reject non-persistable provider dates
  it("rejects an out-of-range event timestamp", () => {
    const body = Buffer.from(
      JSON.stringify({
        event: {
          environment: "PRODUCTION",
          event_timestamp_ms: Number.MAX_VALUE,
          id: "event-1",
          type: "TEST",
        },
      })
    );

    expect(parseRevenueCatWebhook(body, "production")).toBeNull();
  });

  // normalize documented api v2 subscription fields
  it("maps millisecond dates and nested storefront product metadata", async () => {
    process.env.REVENUECAT_PROJECT_ID = "project-test";
    process.env.REVENUECAT_V2_SECRET_API_KEY = "secret-test";
    const endsAt = NOW.getTime() + 30 * 24 * 60 * 60 * 1_000;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({
          items: [
            {
              auto_renewal_status: "will_renew",
              current_period_ends_at: endsAt,
              entitlements: {
                items: [
                  {
                    lookup_key: "ferry_fyi_supporter",
                    products: {
                      items: [
                        {
                          id: "product-monthly",
                          state: "active",
                          store_identifier: "supporter_monthly",
                          subscription: { duration: "P1M" },
                        },
                      ],
                    },
                    state: "active",
                  },
                ],
              },
              gives_access: true,
              id: "subscription-1",
              product_id: "product-monthly",
              starts_at: NOW.getTime(),
              status: "active",
              store: "rc_billing",
            },
            {
              auto_renewal_status: "will_not_renew",
              current_period_ends_at: endsAt,
              entitlements: { items: [] },
              gives_access: false,
              id: "subscription-2",
              product_id: "product-monthly",
              starts_at: NOW.getTime(),
              status: "in_billing_retry",
              store: "play_store",
            },
          ],
          object: "list",
        }),
        ok: true,
        status: 200,
      })
    );

    const subscriptions = await listRevenueCatSubscriptions(
      APP_USER_ID,
      "production"
    );

    expect(subscriptions).toHaveLength(2);
    expect(subscriptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activeUntil: new Date(endsAt),
          entitlementIdentifiers: ["ferry_fyi_supporter"],
          planInterval: "month",
          productIdentifier: "supporter_monthly",
          startsAt: NOW,
        }),
        expect.objectContaining({
          givesAccess: false,
          lifecycleState: "billing-issue",
          willRenew: false,
        }),
      ])
    );
  });

  // use the provider's read-only portal endpoint
  it("gets a single-use web billing management URL", async () => {
    process.env.REVENUECAT_PROJECT_ID = "project-test";
    process.env.REVENUECAT_V2_SECRET_API_KEY = "secret-test";
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        management_url:
          "https://billing.revenuecat.com/app/subscription?token=test",
      }),
      ok: true,
      status: 200,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createRevenueCatManagementUrl("subscription-1")
    ).resolves.toBe(
      "https://billing.revenuecat.com/app/subscription?token=test"
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
});
