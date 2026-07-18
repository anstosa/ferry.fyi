export const MAX_POLICY_REVIEW_AGE_DAYS = 90;

export interface FareCollectionPolicy {
  arrivingTerminalId: string;
  departingTerminalId: string;
  fareCollected: boolean;
  noFareMessage?: string;
  noFareSourceUrl?: string;
  policyVersion: string;
  reviewedAt: string;
  reviewedBy: string;
  reviewedForCacheFlushGeneration: string | null;
  roundTrip: boolean;
  sourceUrl: string;
}

/**
 * WSDOT fare cache generation observed during the 2026-07-18 policy audit.
 * A later generation intentionally makes current fare results unavailable until
 * this table is re-audited; see docs/fare-collection-policy-audit.md.
 */
export const FARE_POLICY_REVIEWED_CACHE_FLUSH_GENERATION =
  "/Date(1784324310423-0700)/";
export const FARE_POLICY_REVIEWED_AT = "2026-07-18T20:51:40.000Z";
export const FARE_POLICY_REVIEWED_BY = "omx-fare-policy-audit";
const policyVersion = "2026-07-18";
const auditedTripDate = "2026-07-18";
const faresRestUrl = "https://www.wsdot.wa.gov/ferries/api/fares/rest";

const sourceUrl = (departingTerminalId: string, arrivingTerminalId: string) =>
  `${faresRestUrl}/terminalcombo/${auditedTripDate}/${departingTerminalId}/${arrivingTerminalId}`;

const auditedEntry = (
  departingTerminalId: string,
  arrivingTerminalId: string,
  fareCollected: boolean,
  roundTrip: boolean,
  noFareMessage?: string
): FareCollectionPolicy => {
  const citation = sourceUrl(departingTerminalId, arrivingTerminalId);
  return {
    arrivingTerminalId,
    departingTerminalId,
    fareCollected,
    ...(noFareMessage ? { noFareMessage, noFareSourceUrl: citation } : {}),
    policyVersion,
    reviewedAt: FARE_POLICY_REVIEWED_AT,
    reviewedBy: FARE_POLICY_REVIEWED_BY,
    reviewedForCacheFlushGeneration:
      FARE_POLICY_REVIEWED_CACHE_FLUSH_GENERATION,
    // This maintained input remains an explicit product decision. The WSDOT
    // collection descriptions audited here do not determine its value.
    roundTrip,
    sourceUrl: citation,
  };
};

/**
 * Complete, direction-specific policy audited against WSDOT terminalcombo and
 * terminalcomboverbose on 2026-07-18. Do not derive collection behavior from
 * provider prose at runtime; update this table through the documented audit.
 */
export const FARE_COLLECTION_POLICY: FareCollectionPolicy[] = [
  auditedEntry("16", "21", true, true),
  auditedEntry("21", "16", false, true, "No fares are collected at Tahlequah."),
  auditedEntry("4", "7", true, true),
  auditedEntry("7", "4", true, true),
  auditedEntry("3", "7", true, true),
  auditedEntry("7", "3", true, true),
  auditedEntry("12", "8", true, true),
  auditedEntry("8", "12", true, true),
  auditedEntry("14", "5", true, true),
  auditedEntry("5", "14", true, true),
  auditedEntry("11", "17", true, true),
  auditedEntry("17", "11", true, true),
  auditedEntry("20", "9", true, true),
  auditedEntry("9", "20", true, true),
  auditedEntry(
    "22",
    "9",
    false,
    true,
    "No fares are collected at Vashon Island."
  ),
  auditedEntry("9", "22", true, true),
  auditedEntry("20", "22", true, true),
  auditedEntry(
    "22",
    "20",
    false,
    true,
    "No fares are collected at Vashon Island."
  ),
];

export const validateFareCollectionPolicy = (
  entries: FareCollectionPolicy[],
  departingTerminalId: string,
  arrivingTerminalId: string,
  liveGeneration: string | null,
  now: Date
):
  | { errors: string[]; ok: false }
  | { ok: true; value: FareCollectionPolicy } => {
  const matches = entries.filter(
    (entry) =>
      entry.departingTerminalId === departingTerminalId &&
      entry.arrivingTerminalId === arrivingTerminalId
  );
  if (matches.length !== 1) {
    return {
      ok: false,
      errors: [
        matches.length ? "Duplicate fare policy." : "Missing fare policy.",
      ],
    };
  }
  const entry = matches[0];
  const reviewedAt = new Date(entry.reviewedAt);
  const age = now.getTime() - reviewedAt.getTime();
  if (
    !liveGeneration ||
    entry.reviewedForCacheFlushGeneration !== liveGeneration ||
    !Number.isFinite(reviewedAt.getTime()) ||
    age < 0 ||
    age > MAX_POLICY_REVIEW_AGE_DAYS * 86400000
  ) {
    return {
      ok: false,
      errors: ["Fare policy is not current for the live WSDOT generation."],
    };
  }
  if (
    !entry.fareCollected &&
    (!entry.noFareMessage || !entry.noFareSourceUrl)
  ) {
    return {
      ok: false,
      errors: ["No-fare policy lacks an official explanation."],
    };
  }
  return { ok: true, value: entry };
};
