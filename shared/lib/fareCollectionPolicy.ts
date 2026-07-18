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

const pairs = [
  ["16", "21"],
  ["4", "7"],
  ["3", "7"],
  ["12", "8"],
  ["14", "5"],
  ["11", "17"],
  ["20", "9"],
  ["22", "9"],
  ["20", "22"],
] as const;
const noFareDepartures = new Set(["21", "22"]);
const sourceUrl =
  "https://www.wsdot.wa.gov/ferries/api/fares/documentation/rest.html";

/** Complete two-terminal route policy. It is intentionally unreviewed until an
 * operator records the currently observed WSDOT cache-flush generation. */
export const FARE_COLLECTION_POLICY: FareCollectionPolicy[] = pairs.flatMap(
  ([a, b]) =>
    [a, b].map((departingTerminalId, index) => {
      const fareCollected = !noFareDepartures.has(departingTerminalId);
      return {
        arrivingTerminalId: index === 0 ? b : a,
        departingTerminalId,
        fareCollected,
        ...(fareCollected
          ? {}
          : {
              noFareMessage: "No fare is collected in this direction.",
              noFareSourceUrl: sourceUrl,
            }),
        policyVersion: "2026-07-18",
        reviewedAt: "1970-01-01T00:00:00.000Z",
        reviewedBy: "unreviewed",
        reviewedForCacheFlushGeneration: null,
        roundTrip: true,
        sourceUrl,
      };
    })
);

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
