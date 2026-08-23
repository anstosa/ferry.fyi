import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type {
  SupporterEnvironment,
  SupporterLifecycleState,
  SupporterPlanInterval,
  SupporterStore,
} from "shared/contracts/supporter";
import { isObject } from "shared/lib/objects";

export const REVENUECAT_PROVIDER_PROJECT_KEY = "revenuecat-primary";
const REVENUECAT_API_ORIGIN = "https://api.revenuecat.com";
const REVENUECAT_SIGNATURE_MAX_AGE_SECONDS = 300;
const REVENUECAT_PAGE_LIMIT = 100;
const REVENUECAT_REQUEST_TIMEOUT_MS = 10_000;

export interface RevenueCatSubscriptionSnapshot {
  activeUntil: Date | null;
  billingIssueAt: Date | null;
  entitlementIdentifiers: string[];
  givesAccess: boolean;
  id: string;
  lifecycleState: SupporterLifecycleState;
  planInterval: SupporterPlanInterval;
  productIdentifier: string;
  providerUpdatedAt: Date | null;
  refundedAt: Date | null;
  revokedAt: Date | null;
  startsAt: Date | null;
  store: SupporterStore;
  willRenew: boolean;
}

export interface RevenueCatWebhookEnvelope {
  appId: string | null;
  appUserIds: string[];
  environment: SupporterEnvironment;
  eventId: string;
  eventTimestamp: Date;
  eventType: string;
}

// require one server configuration value
const getRequiredEnvironmentValue = (name: string): string => {
  const value = process.env[name]?.trim();
  // missing configuration guard
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
};

// compare secrets without early exit
const secretsMatch = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  // equal length guard
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};

// normalize one provider date
const parseDate = (value: unknown): Date | null => {
  let timestamp = Number.NaN;
  // numeric timestamp guard
  if (typeof value === "number") {
    timestamp = value;
  } else if (typeof value === "string") {
    // numeric string guard
    if (/^[0-9]+$/.test(value)) {
      timestamp = Number(value);
    } else {
      timestamp = Date.parse(value);
    }
  }
  // valid timestamp guard
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  const date = new Date(timestamp);
  // valid date guard
  return Number.isNaN(date.getTime()) ? null : date;
};

// normalize one provider identifier
const parseIdentifier = (value: unknown): string | null => {
  // bounded identifier guard
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    return null;
  }
  return value;
};

// normalize one provider url
const parseUrl = (value: unknown): string | null => {
  // bounded url guard
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    return null;
  }
  return value;
};

// read one pagination cursor
const getNextPageCursor = (value: unknown): string | null => {
  // object cursor guard
  if (isObject(value)) {
    return parseIdentifier(value.starting_after);
  }
  const url = parseUrl(value);
  // url cursor guard
  if (!url) {
    return null;
  }
  // isolate malformed provider urls
  try {
    return parseIdentifier(
      new URL(url, REVENUECAT_API_ORIGIN).searchParams.get("starting_after")
    );
  } catch {
    return null;
  }
};

// normalize one store
const normalizeStore = (value: unknown): SupporterStore => {
  const store = String(value ?? "").toLowerCase();
  // app store mapping
  if (store === "app_store" || store === "appstore") {
    return "app_store";
  }
  // play store mapping
  if (store === "play_store" || store === "playstore") {
    return "play_store";
  }
  // web billing mapping
  if (
    store === "rc_billing" ||
    store === "revenuecat_billing" ||
    store === "stripe"
  ) {
    return "rc_billing";
  }
  return "unknown";
};

// infer one product interval
const normalizeInterval = (
  productIdentifier: string,
  duration: unknown
): SupporterPlanInterval => {
  const text = `${productIdentifier} ${String(duration ?? "")}`.toLowerCase();
  // annual product guard
  if (/annual|year|p1y/.test(text)) {
    return "year";
  }
  // monthly product guard
  if (/month|p1m/.test(text)) {
    return "month";
  }
  return "unknown";
};

// normalize one lifecycle state
const normalizeLifecycle = (
  status: unknown,
  givesAccess: boolean,
  willRenew: boolean
): SupporterLifecycleState => {
  const normalized = String(status ?? "").toLowerCase();
  // revocation guard
  if (normalized.includes("revok")) {
    return "revoked";
  }
  // refund guard
  if (normalized.includes("refund")) {
    return "refunded";
  }
  // grace period guard
  if (normalized.includes("grace")) {
    return "grace";
  }
  // billing retry guard
  if (normalized.includes("billing") || normalized.includes("past_due")) {
    return "billing-issue";
  }
  // paid access guard
  if (givesAccess) {
    return willRenew ? "active" : "cancelled-active";
  }
  // expired guard
  if (normalized.includes("expir") || normalized.includes("cancel")) {
    return "expired";
  }
  return "unknown-inactive";
};

// collect entitlement lookup keys
const getEntitlementIdentifiers = (input: unknown): string[] => {
  // entitlement object guard
  if (!isObject(input)) {
    return [];
  }
  const items = Array.isArray(input.items) ? input.items : [];
  const identifiers = new Set<string>();
  // collect bounded entitlement ids
  for (const item of items) {
    // entitlement row guard
    if (!isObject(item)) {
      continue;
    }
    // active association guard
    if ("state" in item && item.state !== "active") {
      continue;
    }
    const identifier = parseIdentifier(item.lookup_key ?? item.id);
    // identifier guard
    if (identifier) {
      identifiers.add(identifier);
    }
  }
  return [...identifiers].sort();
};

// resolve the storefront product nested in entitlement data
const getSubscriptionProduct = (
  input: unknown,
  productId: string
): { duration: unknown; identifier: string } | null => {
  // entitlement collection guard
  if (!isObject(input)) {
    return null;
  }
  const entitlements = Array.isArray(input.items) ? input.items : [];
  // search active entitlement products
  for (const entitlement of entitlements) {
    // active entitlement guard
    if (
      !isObject(entitlement) ||
      ("state" in entitlement && entitlement.state !== "active") ||
      !isObject(entitlement.products)
    ) {
      continue;
    }
    const products = Array.isArray(entitlement.products.items)
      ? entitlement.products.items
      : [];
    // search matching provider product
    for (const product of products) {
      // active product guard
      if (
        !isObject(product) ||
        product.id !== productId ||
        ("state" in product && product.state !== "active")
      ) {
        continue;
      }
      const identifier = parseIdentifier(product.store_identifier);
      // storefront identifier guard
      if (identifier) {
        return {
          duration: isObject(product.subscription)
            ? product.subscription.duration
            : null,
          identifier,
        };
      }
    }
  }
  return null;
};

// normalize one subscription row
const normalizeSubscription = (
  input: unknown
): RevenueCatSubscriptionSnapshot | null => {
  // provider row guard
  if (!isObject(input)) {
    return null;
  }
  const id = parseIdentifier(input.id);
  const productId = parseIdentifier(input.product_id);
  // required identifier guard
  if (!id || !productId) {
    return null;
  }
  const product = getSubscriptionProduct(input.entitlements, productId);
  const productIdentifier = product?.identifier ?? productId;
  const givesAccess = input.gives_access === true;
  const willRenew = [
    "has_already_renewed",
    "will_change_product",
    "will_renew",
  ].includes(String(input.auto_renewal_status).toLowerCase());
  const lifecycleState = normalizeLifecycle(
    input.status,
    givesAccess,
    willRenew
  );
  return {
    activeUntil: parseDate(input.ends_at ?? input.current_period_ends_at),
    billingIssueAt:
      lifecycleState === "billing-issue" ? parseDate(input.updated_at) : null,
    entitlementIdentifiers: getEntitlementIdentifiers(input.entitlements),
    givesAccess,
    id,
    lifecycleState,
    planInterval: normalizeInterval(
      productIdentifier,
      product?.duration ?? input.duration
    ),
    productIdentifier,
    providerUpdatedAt: parseDate(input.updated_at),
    refundedAt:
      lifecycleState === "refunded" ? parseDate(input.updated_at) : null,
    revokedAt:
      lifecycleState === "revoked" ? parseDate(input.updated_at) : null,
    startsAt: parseDate(input.starts_at),
    store: normalizeStore(input.store),
    willRenew,
  };
};

// call RevenueCat API v2
const revenueCatRequest = async <T>(
  path: string,
  init?: RequestInit
): Promise<T | null> => {
  const secret = getRequiredEnvironmentValue("REVENUECAT_V2_SECRET_API_KEY");
  const response = await fetch(`${REVENUECAT_API_ORIGIN}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${secret}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: init?.signal ?? AbortSignal.timeout(REVENUECAT_REQUEST_TIMEOUT_MS),
  });
  // unknown customer guard
  if (response.status === 404) {
    return null;
  }
  // provider response guard
  if (!response.ok) {
    const error = new Error(
      `RevenueCat API request failed with ${response.status}`
    );
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return (await response.json()) as T;
};

/** Reads every environment-scoped subscription page for one customer. */
export const listRevenueCatSubscriptions = async (
  appUserId: string,
  environment: SupporterEnvironment
): Promise<RevenueCatSubscriptionSnapshot[]> => {
  const projectId = encodeURIComponent(
    getRequiredEnvironmentValue("REVENUECAT_PROJECT_ID")
  );
  const customerId = encodeURIComponent(appUserId);
  const subscriptions: RevenueCatSubscriptionSnapshot[] = [];
  let cursor: string | null = null;
  // consume every provider page
  for (let page = 0; page < REVENUECAT_PAGE_LIMIT; page += 1) {
    const search = new URLSearchParams({
      environment,
      limit: String(REVENUECAT_PAGE_LIMIT),
    });
    // cursor guard
    if (cursor) {
      search.set("starting_after", cursor);
    }
    const result = await revenueCatRequest<Record<string, unknown>>(
      `/v2/projects/${projectId}/customers/${customerId}/subscriptions?${search.toString()}`
    );
    // unknown customer guard
    if (!result) {
      return [];
    }
    const items = Array.isArray(result.items) ? result.items : [];
    // normalize provider rows
    for (const item of items) {
      const subscription = normalizeSubscription(item);
      // supported row guard
      if (subscription) {
        subscriptions.push(subscription);
      }
    }
    cursor = getNextPageCursor(result.next_page);
    // final page guard
    if (!cursor) {
      break;
    }
  }
  return subscriptions;
};

/** Creates a single-use RevenueCat web billing management URL. */
export const createRevenueCatManagementUrl = async (
  providerSubscriptionId: string
): Promise<string> => {
  const projectId = encodeURIComponent(
    getRequiredEnvironmentValue("REVENUECAT_PROJECT_ID")
  );
  const subscriptionId = encodeURIComponent(providerSubscriptionId);
  const result = await revenueCatRequest<Record<string, unknown>>(
    `/v2/projects/${projectId}/subscriptions/${subscriptionId}/authenticated_management_url`
  );
  const url = result && parseUrl(result.url ?? result.management_url);
  // url guard
  if (!url || !url.startsWith("https://")) {
    throw new Error("RevenueCat management URL was unavailable");
  }
  return url;
};

/** Hashes the exact webhook body without retaining it. */
export const hashRevenueCatWebhookBody = (body: Buffer): string =>
  createHash("sha256").update(body).digest("hex");

/** Validates RevenueCat authorization and exact-byte HMAC headers. */
export const verifyRevenueCatWebhook = ({
  authorization,
  body,
  environment,
  now = new Date(),
  signature,
}: {
  authorization: string | undefined;
  body: Buffer;
  environment: SupporterEnvironment;
  now?: Date;
  signature: string | undefined;
}): boolean => {
  const prefix = environment === "production" ? "PRODUCTION" : "SANDBOX";
  const expectedAuthorization = getRequiredEnvironmentValue(
    `REVENUECAT_${prefix}_WEBHOOK_AUTHORIZATION`
  );
  const hmacSecret = getRequiredEnvironmentValue(
    `REVENUECAT_${prefix}_WEBHOOK_HMAC_SECRET`
  );
  // authorization guard
  if (!authorization || !secretsMatch(authorization, expectedAuthorization)) {
    return false;
  }
  const parts = Object.fromEntries(
    String(signature ?? "")
      .split(",")
      .map((part) => part.trim().split("=", 2))
      .filter((part) => part.length === 2)
  );
  const timestamp = Number(parts.t);
  // signature shape guard
  if (!Number.isSafeInteger(timestamp) || typeof parts.v1 !== "string") {
    return false;
  }
  // replay window guard
  if (
    Math.abs(Math.floor(now.getTime() / 1_000) - timestamp) >
    REVENUECAT_SIGNATURE_MAX_AGE_SECONDS
  ) {
    return false;
  }
  const payload = Buffer.concat([Buffer.from(`${timestamp}.`), body]);
  const expectedSignature = createHmac("sha256", hmacSecret)
    .update(payload)
    .digest("hex");
  return secretsMatch(parts.v1.toLowerCase(), expectedSignature);
};

// add a bounded provider app user id
const addAppUserId = (target: Set<string>, value: unknown): void => {
  const identifier = parseIdentifier(value);
  // custom uuid guard
  if (
    identifier &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      identifier
    )
  ) {
    target.add(identifier.toLowerCase());
  }
};

/** Parses only the privacy-minimal webhook routing envelope. */
export const parseRevenueCatWebhook = (
  body: Buffer,
  routeEnvironment: SupporterEnvironment
): RevenueCatWebhookEnvelope | null => {
  let input: unknown;
  // isolate malformed json
  try {
    input = JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
  // envelope guard
  if (!isObject(input) || !isObject(input.event)) {
    return null;
  }
  const { event } = input;
  const eventId = parseIdentifier(event.id);
  const eventType = parseIdentifier(event.type);
  const eventTimestampMs = Number(event.event_timestamp_ms);
  const eventTimestamp = new Date(eventTimestampMs);
  const providerEnvironment = String(event.environment ?? "").toLowerCase();
  const environment =
    providerEnvironment === "production" || providerEnvironment === "sandbox"
      ? providerEnvironment
      : routeEnvironment;
  // fixed route guard
  if (
    !eventId ||
    !eventType ||
    environment !== routeEnvironment ||
    !Number.isFinite(eventTimestampMs) ||
    Number.isNaN(eventTimestamp.getTime())
  ) {
    return null;
  }
  const appUserIds = new Set<string>();
  addAppUserId(appUserIds, event.app_user_id);
  addAppUserId(appUserIds, event.original_app_user_id);
  // collect alternate provider aliases
  for (const value of Array.isArray(event.aliases) ? event.aliases : []) {
    addAppUserId(appUserIds, value);
  }
  // transfer source ids
  for (const value of Array.isArray(event.transferred_from)
    ? event.transferred_from
    : []) {
    addAppUserId(appUserIds, value);
  }
  // transfer destination ids
  for (const value of Array.isArray(event.transferred_to)
    ? event.transferred_to
    : []) {
    addAppUserId(appUserIds, value);
  }
  return {
    appId: parseIdentifier(event.app_id),
    appUserIds: [...appUserIds].sort(),
    environment,
    eventId,
    eventTimestamp,
    eventType,
  };
};
