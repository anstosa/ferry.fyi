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
 * WSDOT fare cache generation observed during the 2026-07-19 policy audit.
 * It is audit metadata only: WSDOT refreshes this generation routinely without
 * changing its collection rules, so it must not suppress otherwise valid fares.
 */
export const FARE_POLICY_REVIEWED_CACHE_FLUSH_GENERATION =
  "/Date(1784494652500-0700)/";
export const FARE_POLICY_REVIEWED_AT = "2026-07-19T16:00:00.000Z";
export const FARE_POLICY_REVIEWED_BY = "omx-fare-policy-audit";
const policyVersion = "2026-07-19";
const auditedTripDate = "2026-07-19";
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
 * terminalcomboverbose on 2026-07-19. Do not derive collection behavior from
 * provider prose at runtime; update this table through the documented audit.
 */
const FARE_COLLECTED_DIRECTIONS = [
  ["1", "10"],
  ["1", "13"],
  ["1", "15"],
  ["1", "18"],
  ["3", "7"],
  ["4", "7"],
  ["5", "14"],
  ["7", "3"],
  ["7", "4"],
  ["8", "12"],
  ["9", "20"],
  ["9", "22"],
  ["10", "13"],
  ["10", "15"],
  ["10", "18"],
  ["11", "17"],
  ["12", "8"],
  ["13", "10"],
  ["13", "15"],
  ["13", "18"],
  ["14", "5"],
  ["15", "10"],
  ["15", "13"],
  ["15", "18"],
  ["16", "21"],
  ["17", "11"],
  ["18", "10"],
  ["18", "13"],
  ["18", "15"],
  ["20", "9"],
  ["20", "22"],
] as const;

const NO_FARE_DIRECTIONS = [
  ["10", "1", "No fares are collected at Friday Harbor."],
  ["13", "1", "No fares are collected at Lopez Island."],
  ["15", "1", "No fares are collected at Orcas Island."],
  ["18", "1", "No fares are collected at Shaw Island."],
  ["21", "16", "No fares are collected at Tahlequah."],
  ["22", "9", "No fares are collected at Vashon Island."],
  ["22", "20", "No fares are collected at Vashon Island."],
] as const;

export const FARE_COLLECTION_POLICY: FareCollectionPolicy[] = [
  ...FARE_COLLECTED_DIRECTIONS.map(
    ([departingTerminalId, arrivingTerminalId]) =>
      auditedEntry(departingTerminalId, arrivingTerminalId, true, true)
  ),
  ...NO_FARE_DIRECTIONS.map(
    ([departingTerminalId, arrivingTerminalId, noFareMessage]) =>
      auditedEntry(
        departingTerminalId,
        arrivingTerminalId,
        false,
        true,
        noFareMessage
      )
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
    !Number.isFinite(reviewedAt.getTime()) ||
    age < 0 ||
    age > MAX_POLICY_REVIEW_AGE_DAYS * 86400000
  ) {
    return {
      ok: false,
      errors: ["Fare policy is not recently audited."],
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
