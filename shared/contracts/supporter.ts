export const SUPPORTER_ENTITLEMENT_IDENTIFIER = "ferry_fyi_supporter";
export const SUPPORTER_OFFERING_IDENTIFIER = "default";

export type SupporterAccessState = "active" | "inactive";
export type SupporterEnvironment = "production" | "sandbox";
export type SupporterLifecycleState =
  | "active"
  | "billing-issue"
  | "cancelled-active"
  | "expired"
  | "grace"
  | "none"
  | "refunded"
  | "revoked"
  | "unknown-inactive";
export type SupporterPlanInterval = "month" | "unknown" | "year";
export type SupporterStore =
  | "app_store"
  | "play_store"
  | "rc_billing"
  | "unknown";

export interface SupporterSummary {
  active: boolean;
  activeUntil: string | null;
  adsEnabled: boolean;
  lifecycleState: SupporterLifecycleState;
  resolved: boolean;
  revision: string;
}

export interface SupporterSource {
  activeUntil: string | null;
  lifecycleState: SupporterLifecycleState;
  planInterval: SupporterPlanInterval;
  productIdentifier: string;
  store: SupporterStore;
  willRenew: boolean;
}

export interface SupporterCheckoutAvailability {
  android: boolean;
  ios: boolean;
  web: boolean;
}

export interface SupporterStatus extends SupporterSummary {
  appUserId: string;
  checkoutAvailability: SupporterCheckoutAvailability;
  degradedCode: string | null;
  lastReconciledAt: string | null;
  lastVerifiedAt: string | null;
  supporterBadgeVisible: boolean;
  sources: SupporterSource[];
}

export interface SupporterReconcileResult {
  status: SupporterStatus;
  verification: "complete" | "pending";
}

export interface SupporterManagementResult {
  expiresAt: string | null;
  oneTime: boolean;
  url: string;
}

export interface SupporterProductOption {
  identifier: string;
  interval: "month" | "year";
  price: string;
}

export interface SupporterPurchaseResult {
  outcome: "cancelled" | "purchased" | "verification_pending";
  status: SupporterStatus;
}

const SUPPORTER_REVISION_PATTERN = /^v1:(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/;
const MAX_SIGNED_BIGINT = BigInt("9223372036854775807");

/** Validates the opaque supporter projection revision. */
export const isSupporterRevision = (value: unknown): value is string => {
  // revision shape guard
  if (typeof value !== "string" || value.length > 64) {
    return false;
  }
  const match = SUPPORTER_REVISION_PATTERN.exec(value);
  // revision match guard
  if (!match) {
    return false;
  }
  // bigint range guard
  return (
    BigInt(match[1]) <= MAX_SIGNED_BIGINT &&
    BigInt(match[2]) <= MAX_SIGNED_BIGINT
  );
};

/** Builds a compact inactive supporter summary. */
export const getInactiveSupporterSummary = (
  authorityGeneration: string = "1"
): SupporterSummary => ({
  active: false,
  activeUntil: null,
  adsEnabled: false,
  lifecycleState: "none",
  resolved: true,
  revision: `v1:0:${authorityGeneration}`,
});
