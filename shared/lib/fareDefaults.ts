import type {
  FareDefaultRate,
  FareDefaultRateComparison,
  FareLineItem,
  FareLineItemSelection,
  FareQuote,
} from "../contracts/fares";

type DefaultFareCategory = "passenger" | "standardVehicle";

// choose one unambiguous standard rider without charging the driver again
export const getDefaultFareSelections = (
  fares: FareLineItem[],
  category: DefaultFareCategory
): FareLineItemSelection[] | null => {
  const label =
    category === "passenger"
      ? /^Adult(?:\s*\(age\s*19\s*[-–]\s*64\))?$/i
      : /^Vehicle Under 22['’](?:\s*\(standard veh\))?\s*&\s*Driver$/i;
  // never choose discounts, passes or an ambiguous duplicate
  const matches = fares.filter((fare) => label.test(fare.label.trim()));
  // invalid catalog ids cannot become quote requests
  if (
    matches.length !== 1 ||
    !Number.isInteger(matches[0].id) ||
    matches[0].id <= 0
  ) {
    return null;
  }
  return [{ fareLineItemId: matches[0].id, quantity: 1 }];
};

// use explicit source totals rather than doubling or halving a catalog price
export const getQuotedFareRates = (
  quote: FareQuote,
  state: "current" | "stale"
): FareDefaultRateComparison => {
  // duplicate, negative or malformed source rows stay unavailable
  const rate = (type: "depart" | "total"): FareDefaultRate | null => {
    const rows = quote.totals.filter((total) => total.type === type);
    // zero is an explicit valid amount rather than an absent price
    if (
      rows.length !== 1 ||
      !Number.isFinite(rows[0].amount) ||
      rows[0].amount < 0
    ) {
      return null;
    }
    return { amount: rows[0].amount, freshness: quote.freshness, state };
  };
  // a one-way-only response does not establish a return fare
  if (!quote.request.roundTrip) {
    return { oneWay: rate("total"), roundTrip: null };
  }
  return { oneWay: rate("depart"), roundTrip: rate("total") };
};
