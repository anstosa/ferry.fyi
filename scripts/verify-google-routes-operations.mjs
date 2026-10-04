#!/usr/bin/env node
/* global URL, console, process */

import { readFile } from "node:fs/promises";

const EXPECTED_POLICIES = new Map([
  ["compute_routes_essentials:80", 7_999],
  ["compute_routes_essentials:100", 9_999],
  ["compute_routes_pro:80", 3_999],
  ["compute_routes_pro:100", 4_999],
]);
const EXPECTED_CAPS = {
  compute_routes_essentials: 10_000,
  compute_routes_pro: 5_000,
};
const PRODUCTION_METRIC_TYPE =
  "custom.googleapis.com/ferry_fyi/google_routes/month_to_date_estimated_requests";
const ROUTES_BILLING_SERVICE = "services/0161-1616-FF1D";
const PLACES_BILLING_SERVICE = "services/0776-5E2E-55E3";

/** Adds a failed invariant without exposing fixture secrets. */
function requireCondition(condition, message, errors) {
  // collect all safe failures in one verification pass
  if (!condition) {
    errors.push(message);
  }
}

/** compares a string array as a duplicate-free set */
function hasExactStringMembers(actual, expected) {
  // reject missing, duplicate, or extra service resources
  if (
    !Array.isArray(actual) ||
    actual.length !== expected.length ||
    !actual.every((value) => typeof value === "string")
  ) {
    return false;
  }
  return [...actual].sort().join(",") === [...expected].sort().join(",");
}

/** derives the exact WIF binding fields from canonical inputs */
function deriveWifBinding(wif) {
  const roleMatch =
    typeof wif?.awsRoleArn === "string"
      ? /^arn:aws:iam::(\d{12}):role\/([A-Za-z0-9+=,.@_-]+)$/.exec(
          wif.awsRoleArn
        )
      : null;
  const providerMatch =
    typeof wif?.providerResource === "string"
      ? /^\/\/iam\.googleapis\.com\/projects\/(\d+)\/locations\/global\/workloadIdentityPools\/([a-z0-9-]+)\/providers\/([a-z0-9-]+)$/.exec(
          wif.providerResource
        )
      : null;
  // stop before deriving trust fields from malformed identifiers
  if (!roleMatch || !providerMatch) {
    return null;
  }
  const [, awsAccountId, mappedAwsRoleName] = roleMatch;
  const [, googleProjectNumber, poolId] = providerMatch;
  return {
    attributeCondition: `assertion.account == '${awsAccountId}' && attribute.aws_role == '${mappedAwsRoleName}'`,
    awsAccountId,
    mappedAwsRoleName,
    principalSet: `principalSet://iam.googleapis.com/projects/${googleProjectNumber}/locations/global/workloadIdentityPools/${poolId}/attribute.aws_role/${mappedAwsRoleName}`,
  };
}

/** Validates a redacted external-operations evidence export. */
export function verifyGoogleRoutesOperations(evidence) {
  const errors = [];
  const placesEnabled = evidence?.placesEnabled === true;
  const expectedPolicies = new Map(EXPECTED_POLICIES);
  const expectedCaps = { ...EXPECTED_CAPS };
  // require separate autocomplete notifications only when places is in scope
  if (placesEnabled) {
    expectedPolicies.set("autocomplete_requests:80", 7_999);
    expectedPolicies.set("autocomplete_requests:100", 9_999);
    expectedCaps.autocomplete_requests = 10_000;
  }
  const channel = evidence?.notificationChannel;
  requireCondition(
    typeof evidence?.monitoringProjectId === "string" &&
      evidence.monitoringProjectId.length > 0,
    "monitoringProjectId is required",
    errors
  );
  requireCondition(
    channel?.verificationStatus !== "UNVERIFIED",
    "the email notification channel must not be unverified",
    errors
  );
  requireCondition(
    channel?.deliveryAcknowledged === true,
    "the notification channel requires acknowledged email delivery",
    errors
  );
  requireCondition(
    evidence?.productionMetricType === PRODUCTION_METRIC_TYPE,
    "productionMetricType must be the canonical usage metric",
    errors
  );
  const heartbeat = evidence?.zeroHeartbeatMonthlyReset;
  requireCondition(
    heartbeat?.intervalSeconds === 300 &&
      heartbeat?.includesZero === true &&
      heartbeat?.pacificMonthReset === true &&
      heartbeat?.verified === true,
    "five-minute zero-heartbeat monthly-reset evidence is required",
    errors
  );
  requireCondition(
    typeof evidence?.routesProjectId === "string" &&
      evidence.routesProjectId.length > 0,
    "routesProjectId is required",
    errors
  );
  requireCondition(
    typeof evidence?.billingAccountId === "string" &&
      evidence.billingAccountId.length > 0,
    "billingAccountId is required",
    errors
  );
  requireCondition(
    channel?.type === "email" &&
      channel?.enabled === true &&
      channel?.recipientConfirmed === true &&
      typeof channel?.redactedRecipientId === "string" &&
      channel.redactedRecipientId.length > 0,
    "a confirmed enabled email notification channel is required",
    errors
  );

  const policies = Array.isArray(evidence?.alertPolicies)
    ? evidence.alertPolicies
    : [];
  requireCondition(
    policies.length === expectedPolicies.size,
    placesEnabled
      ? "exactly six usage alert policies are required"
      : "exactly four usage alert policies are required",
    errors
  );
  const seen = new Set();
  // validate every policy against the approved one-less thresholds
  for (const policy of policies) {
    const key = `${policy?.sku}:${policy?.percent}`;
    seen.add(key);
    requireCondition(
      expectedPolicies.get(key) === policy?.threshold,
      `invalid threshold for ${key}`,
      errors
    );
    requireCondition(
      policy?.comparison === "COMPARISON_GT" && policy?.duration === "0s",
      `policy ${key} must use strict Above with no retest window`,
      errors
    );
    requireCondition(
      policy?.renotifyInterval === null,
      `policy ${key} must disable renotification`,
      errors
    );
    requireCondition(
      policy?.missingData === null || policy?.missingData === undefined,
      `policy ${key} must omit missing-data evaluation for a zero-duration condition`,
      errors
    );
    requireCondition(
      policy?.notificationChannelId === channel?.id,
      `policy ${key} must use the confirmed email channel`,
      errors
    );
    requireCondition(
      typeof policy?.testProjectId === "string" &&
        policy.testProjectId.length > 0 &&
        typeof policy?.testMetricType === "string" &&
        policy.testMetricType.startsWith("custom.googleapis.com/") &&
        policy.testMetricType !== evidence?.productionMetricType &&
        policy?.openingEmailAcknowledged === true &&
        ["enabled", "suppressed"].includes(policy?.closureEmail),
      `policy ${key} needs isolated opening-email proof and explicit closure behavior`,
      errors
    );
    requireCondition(
      policy?.closureEmail !== "enabled" ||
        policy?.resolvedEmailAcknowledged === true,
      `policy ${key} needs acknowledged resolved-email delivery when closure email is enabled`,
      errors
    );
  }
  // reject duplicate policies that happen to preserve array length
  for (const key of expectedPolicies.keys()) {
    requireCondition(seen.has(key), `missing policy ${key}`, errors);
  }

  requireCondition(
    Object.keys(evidence?.freeTierCaps ?? {}).length ===
      Object.keys(expectedCaps).length &&
      Object.entries(expectedCaps).every(
        ([sku, cap]) => evidence?.freeTierCaps?.[sku] === cap
      ),
    "free-tier caps must match the approved per-SKU allowances",
    errors
  );
  const budget = evidence?.budget;
  const expectedServiceResources = placesEnabled
    ? [ROUTES_BILLING_SERVICE, PLACES_BILLING_SERVICE]
    : [ROUTES_BILLING_SERVICE];
  requireCondition(
    hasExactStringMembers(
      budget?.serviceResourceNames,
      expectedServiceResources
    ),
    "budget serviceResourceNames must exactly match the enabled Google API catalog services",
    errors
  );
  requireCondition(
    evidence?.accountInventory?.complete === true &&
      evidence?.accountInventory?.billingAccountId ===
        evidence?.billingAccountId &&
      Array.isArray(evidence?.accountInventory?.linkedProjectIds) &&
      evidence.accountInventory.linkedProjectIds.includes(
        evidence?.routesProjectId
      ),
    "billing-account project inventory must be complete and include the Routes project",
    errors
  );
  requireCondition(
    budget?.amountUsd === 1 &&
      budget?.calendarPeriod === "MONTH" &&
      budget?.thresholdBasis === "CURRENT_SPEND" &&
      budget?.thresholdPercent === 100,
    "budget must be monthly USD 1 at 100 percent Actual spend",
    errors
  );
  requireCondition(
    budget?.includeCredits === true && budget?.spendCap === false,
    "budget must include applicable credits and must not cap spend",
    errors
  );
  requireCondition(
    budget?.notificationChannelId === channel?.id &&
      budget?.projectId === evidence?.routesProjectId &&
      budget?.billingAccountId === evidence?.billingAccountId &&
      Array.isArray(budget?.serviceScope) &&
      budget.serviceScope.length > 0 &&
      budget.serviceScope.every((service) =>
        /maps|routes|places/i.test(String(service))
      ),
    "budget scope must match the Routes project, billing account, service, and email channel",
    errors
  );
  requireCondition(
    budget?.monthlyDollarCap === undefined,
    "monthlyDollarCap is unsupported; overage remains allowed",
    errors
  );

  const wif = evidence?.wif;
  const expectedWif = deriveWifBinding(wif);
  const mapping = wif?.attributeMapping;
  requireCondition(
    expectedWif !== null &&
      wif?.awsAccountId === expectedWif?.awsAccountId &&
      wif?.mappedAwsRoleName === expectedWif?.mappedAwsRoleName &&
      wif?.principalSet === expectedWif?.principalSet &&
      wif?.attributeCondition === expectedWif?.attributeCondition &&
      mapping?.["google.subject"] === "assertion.arn" &&
      mapping?.["attribute.aws_role"] ===
        "assertion.arn.extract('assumed-role/{role_name}/')" &&
      Object.keys(mapping ?? {}).length === 2 &&
      wif?.googleRole === "roles/monitoring.metricWriter" &&
      wif?.directFederation === true &&
      wif?.preproductionTimeSeriesCreateSmoke === true,
    "WIF must derive one exact AWS role and pool principal for direct monitoring.metricWriter with a live smoke",
    errors
  );
  const key = evidence?.routesApiKey;
  requireCondition(
    key?.routesApiOnly === true &&
      key?.quotaQpm === 60 &&
      Number.isInteger(key?.rotationDays) &&
      key.rotationDays > 0 &&
      key.rotationDays <= 90 &&
      key?.stableIpRestriction === false &&
      key?.existingNetworkingAccepted === true,
    "Routes key evidence must reflect API-only restriction, 60 QPM, rotation, and accepted existing networking",
    errors
  );
  requireCondition(
    evidence?.productionReleaseGate?.approved === true &&
      evidence?.productionReleaseGate?.googleRoutesEnabled === false,
    "external readiness must be approved while the application kill switch remains off",
    errors
  );
  // expand the existing launch proof without weakening the routes-only gate
  if (placesEnabled) {
    const placesKey = evidence?.placesApiKey;
    requireCondition(
      evidence?.placesProjectId === evidence?.routesProjectId &&
        placesKey?.placesApiNewOnly === true &&
        placesKey?.separateKey === true &&
        placesKey?.quotaQpm === 60 &&
        Number.isInteger(placesKey?.rotationDays) &&
        placesKey.rotationDays > 0 &&
        placesKey.rotationDays <= 90 &&
        placesKey?.stableIpRestriction === false &&
        placesKey?.existingNetworkingAccepted === true,
      "Places key evidence must reflect a separate Places API New key in the Routes project, 60 QPM, rotation, and accepted existing networking",
      errors
    );
    requireCondition(
      Array.isArray(budget?.serviceScope) &&
        budget.serviceScope.some((service) => /places/i.test(String(service))),
      "budget scope must also include Places API New",
      errors
    );
    requireCondition(
      evidence?.productionReleaseGate?.googlePlacesEnabled === false,
      "Places readiness must be approved while GOOGLE_PLACES_ENABLED remains off",
      errors
    );
  }
  return errors;
}

/** Loads one redacted evidence file and reports a safe verdict. */
async function main() {
  const inputPath = process.argv[2];
  // require an explicit evidence path
  if (!inputPath) {
    throw new Error(
      "Usage: node scripts/verify-google-routes-operations.mjs <redacted-evidence.json>"
    );
  }
  const evidence = JSON.parse(await readFile(inputPath, "utf8"));
  const errors = verifyGoogleRoutesOperations(evidence);
  // fail CI without echoing the evidence document
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("Google Routes operations evidence verified");
}

// run only for direct cli invocation
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  await main();
}
