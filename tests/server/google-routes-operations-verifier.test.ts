import { describe, expect, it } from "vitest";

import { verifyGoogleRoutesOperations } from "../../scripts/verify-google-routes-operations.mjs";

const PRODUCTION_METRIC_TYPE =
  "custom.googleapis.com/ferry_fyi/google_routes/month_to_date_estimated_requests";

/** Creates complete redacted readiness evidence. */
function validEvidence() {
  const notificationChannel = {
    deliveryAcknowledged: true,
    enabled: true,
    id: "channel-redacted-1",
    recipientConfirmed: true,
    redactedRecipientId: "owner-email-sha256:abc",
    type: "email",
  };
  return {
    accountInventory: {
      billingAccountId: "billing-redacted-1",
      complete: true,
      linkedProjectIds: ["ferry-routes-prod"],
    },
    alertPolicies: [
      ["compute_routes_essentials", 80, 7_999],
      ["compute_routes_essentials", 100, 9_999],
      ["compute_routes_pro", 80, 3_999],
      ["compute_routes_pro", 100, 4_999],
    ].map(([sku, percent, threshold]) => ({
      closureEmail: "suppressed",
      comparison: "COMPARISON_GT",
      duration: "0s",
      missingData: null,
      notificationChannelId: notificationChannel.id,
      openingEmailAcknowledged: true,
      percent,
      renotifyInterval: null,
      sku,
      testMetricType:
        "custom.googleapis.com/ferry_fyi/google_routes/alert_test",
      testProjectId: "ferry-monitoring-prod",
      threshold,
    })),
    billingAccountId: "billing-redacted-1",
    budget: {
      amountUsd: 1,
      billingAccountId: "billing-redacted-1",
      calendarPeriod: "MONTH",
      includeCredits: true,
      notificationChannelId: notificationChannel.id,
      projectId: "ferry-routes-prod",
      serviceResourceNames: ["services/0161-1616-FF1D"],
      serviceScope: ["Google Maps Platform Routes API"],
      spendCap: false,
      thresholdBasis: "CURRENT_SPEND",
      thresholdPercent: 100,
    },
    freeTierCaps: {
      compute_routes_essentials: 10_000,
      compute_routes_pro: 5_000,
    },
    monitoringProjectId: "ferry-monitoring-prod",
    notificationChannel,
    productionMetricType: PRODUCTION_METRIC_TYPE,
    productionReleaseGate: {
      approved: true,
      googleRoutesEnabled: false,
    },
    routesApiKey: {
      existingNetworkingAccepted: true,
      quotaQpm: 60,
      rotationDays: 90,
      routesApiOnly: true,
      stableIpRestriction: false,
    },
    routesProjectId: "ferry-routes-prod",
    zeroHeartbeatMonthlyReset: {
      includesZero: true,
      intervalSeconds: 300,
      pacificMonthReset: true,
      verified: true,
    },
    wif: {
      attributeCondition:
        "assertion.account == '333401878534' && attribute.aws_role == 'ferry-fyi-prod-web-task'",
      attributeMapping: {
        "attribute.aws_role":
          "assertion.arn.extract('assumed-role/{role_name}/')",
        "google.subject": "assertion.arn",
      },
      awsAccountId: "333401878534",
      awsRoleArn: "arn:aws:iam::333401878534:role/ferry-fyi-prod-web-task",
      directFederation: true,
      googleRole: "roles/monitoring.metricWriter",
      mappedAwsRoleName: "ferry-fyi-prod-web-task",
      preproductionTimeSeriesCreateSmoke: true,
      principalSet:
        "principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/ferry-fyi-aws/attribute.aws_role/ferry-fyi-prod-web-task",
      providerResource:
        "//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/ferry-fyi-aws/providers/aws",
    },
  };
}

describe("Google Routes operations verifier", () => {
  // assemble the additional places release evidence without changing routes-only fixtures
  const placesEvidence = () => {
    const base = validEvidence();
    return {
      ...base,
      placesEnabled: true,
      placesProjectId: base.routesProjectId,
      placesApiKey: {
        existingNetworkingAccepted: true,
        placesApiNewOnly: true,
        quotaQpm: 60,
        rotationDays: 90,
        separateKey: true,
        stableIpRestriction: false,
      },
      alertPolicies: [
        ...base.alertPolicies,
        ...[80, 100].map((percent) => {
          // reuse the confirmed channel and isolated email proof for the new sku
          return {
            ...base.alertPolicies[0],
            percent,
            sku: "autocomplete_requests",
            threshold: percent === 80 ? 7_999 : 9_999,
          };
        }),
      ],
      budget: {
        ...base.budget,
        serviceResourceNames: [
          ...base.budget.serviceResourceNames,
          "services/0776-5E2E-55E3",
        ],
        serviceScope: [...base.budget.serviceScope, "Places API (New)"],
      },
      freeTierCaps: { ...base.freeTierCaps, autocomplete_requests: 10_000 },
      productionReleaseGate: {
        ...base.productionReleaseGate,
        googlePlacesEnabled: false,
      },
    };
  };

  // approve autocomplete only with its separate quota and both owner notifications
  it("accepts complete Places evidence in addition to Routes", () => {
    expect(verifyGoogleRoutesOperations(placesEvidence())).toEqual([]);
  });

  // routes-only readiness must not accidentally approve the new billable provider
  it("requires Places notifications, budget coverage, separate key and disabled release gate", () => {
    const evidence = placesEvidence();
    evidence.alertPolicies = evidence.alertPolicies.slice(0, 4);
    evidence.budget.serviceScope = ["Google Maps Platform Routes API"];
    evidence.placesApiKey.separateKey = false;
    evidence.productionReleaseGate.googlePlacesEnabled = true;
    expect(verifyGoogleRoutesOperations(evidence)).toEqual(
      expect.arrayContaining([
        "exactly six usage alert policies are required",
        "missing policy autocomplete_requests:80",
        "missing policy autocomplete_requests:100",
        "budget scope must also include Places API New",
        expect.stringContaining("separate Places API New key"),
        "Places readiness must be approved while GOOGLE_PLACES_ENABLED remains off",
      ])
    );
  });

  // accept the complete redacted release evidence shape
  it("accepts complete evidence", () => {
    expect(verifyGoogleRoutesOperations(validEvidence())).toEqual([]);
  });

  // reject a forecast threshold or a purported monthly cap
  it("rejects incorrect budget behavior", () => {
    const evidence = validEvidence();
    evidence.budget.thresholdBasis = "FORECASTED_SPEND";
    (
      evidence.budget as typeof evidence.budget & { monthlyDollarCap: number }
    ).monthlyDollarCap = 10;

    expect(verifyGoogleRoutesOperations(evidence)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("100 percent Actual"),
        expect.stringContaining("monthlyDollarCap is unsupported"),
      ])
    );
  });

  // reject display labels standing in for catalog resource identities
  it("requires the exact enabled API billing catalog resources", () => {
    const evidence = validEvidence();
    evidence.budget.serviceResourceNames = ["routes.googleapis.com"];

    expect(verifyGoogleRoutesOperations(evidence)).toContain(
      "budget serviceResourceNames must exactly match the enabled Google API catalog services"
    );
  });

  // permit same-project tests only through a distinct custom metric type
  it("requires isolated policy opening-email evidence", () => {
    const evidence = validEvidence();
    evidence.alertPolicies[0].testMetricType = PRODUCTION_METRIC_TYPE;
    evidence.alertPolicies[0].openingEmailAcknowledged = false;

    expect(verifyGoogleRoutesOperations(evidence)).toContain(
      "policy compute_routes_essentials:80 needs isolated opening-email proof and explicit closure behavior"
    );
  });

  // omit unsupported missing-data behavior for zero-duration conditions
  it("rejects missing-data claims and requires five-minute zero heartbeats", () => {
    const evidence = validEvidence();
    (
      evidence.alertPolicies[0] as unknown as {
        missingData: string | null;
      }
    ).missingData = "MISSING_DATA_INACTIVE";
    evidence.zeroHeartbeatMonthlyReset.intervalSeconds = 60;

    expect(verifyGoogleRoutesOperations(evidence)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must omit missing-data evaluation"),
        expect.stringContaining("five-minute zero-heartbeat"),
      ])
    );
  });

  // require acknowledged delivery rather than relying on channel status metadata
  it("requires actual email delivery and rejects an unverified channel", () => {
    const evidence = validEvidence();
    evidence.notificationChannel.deliveryAcknowledged = false;
    (
      evidence.notificationChannel as typeof evidence.notificationChannel & {
        verificationStatus: string;
      }
    ).verificationStatus = "UNVERIFIED";

    expect(verifyGoogleRoutesOperations(evidence)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("acknowledged email delivery"),
        expect.stringContaining("must not be unverified"),
      ])
    );
  });

  // require resolved mail proof only when closure notifications are enabled
  it("requires resolved-email proof for enabled closure notifications", () => {
    const evidence = validEvidence();
    evidence.alertPolicies[0].closureEmail = "enabled";
    const policy = evidence
      .alertPolicies[0] as (typeof evidence.alertPolicies)[number] & {
      resolvedEmailAcknowledged: boolean;
    };
    policy.resolvedEmailAcknowledged = false;

    expect(verifyGoogleRoutesOperations(evidence)).toContain(
      "policy compute_routes_essentials:80 needs acknowledged resolved-email delivery when closure email is enabled"
    );
    policy.resolvedEmailAcknowledged = true;
    expect(verifyGoogleRoutesOperations(evidence)).toEqual([]);
  });

  // reject the old iam-arn-to-sts equality shortcut and mismatched pool binding
  it("derives the WIF account, role, condition, and principal set", () => {
    const evidence = validEvidence();
    evidence.wif.principalSet =
      "principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/other-pool/attribute.aws_role/ferry-fyi-prod-web-task";
    evidence.wif.attributeCondition = evidence.wif.awsRoleArn;

    expect(verifyGoogleRoutesOperations(evidence)).toContain(
      "WIF must derive one exact AWS role and pool principal for direct monitoring.metricWriter with a live smoke"
    );
  });
});
