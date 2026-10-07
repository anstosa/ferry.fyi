import { DateTime } from "luxon";
import React, { type ReactElement } from "react";
import type {
  FareCurrentCatalogResponse,
  FareNoFareResponse,
} from "shared/contracts/fares";

const currency = new Intl.NumberFormat("en-US", {
  currency: "USD",
  style: "currency",
});

// expose the provider catalog without calculating a quote
export const FareCatalogDisclosure = ({
  response,
  departingName,
  arrivingName,
}: {
  response: FareCurrentCatalogResponse | FareNoFareResponse;
  departingName?: string;
  arrivingName?: string;
}): ReactElement => {
  // preserve directions that collect no fare
  if (response.state === "no-fare") {
    return (
      <p>
        {response.noFare.message ?? "No fare is collected in this direction."}
      </p>
    );
  }
  const { fares, freshness, request, collectionDescription } = response.catalog;
  return (
    <details
      className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-blue-dark"
      data-public-fare-catalog
    >
      <summary className="cursor-pointer font-bold text-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 dark:text-green-light">
        Show full fare table
      </summary>
      <div className="mt-4 space-y-3 text-sm">
        <p>
          {departingName ?? request.departingTerminalId} to{" "}
          {arrivingName ?? request.arrivingTerminalId} ·{" "}
          <time dateTime={request.tripDate}>{request.tripDate}</time> ·{" "}
          {request.roundTrip ? "round-trip" : "one-way"} catalog.
        </p>
        {collectionDescription ? <p>{collectionDescription}</p> : null}
        <p>
          Official WSDOT line items, not a personalized quote. WSDOT determines
          eligibility and collection rules.
        </p>
        <p>
          Valid travel dates:{" "}
          <time dateTime={freshness.validFrom}>{freshness.validFrom}</time>{" "}
          through{" "}
          <time dateTime={freshness.validThrough}>
            {freshness.validThrough}
          </time>
          .
        </p>
        <p>
          Source fetched{" "}
          <time
            dateTime={
              DateTime.fromSeconds(freshness.fetchedAt, {
                zone: "utc",
              }).toISO() ?? undefined
            }
          >
            {DateTime.fromSeconds(freshness.fetchedAt, {
              zone: "America/Los_Angeles",
            }).toFormat("MMM d, yyyy, h:mm a ZZZZ")}
          </time>
          . Collection policy: {freshness.policyVersion}.
        </p>
        {freshness.sourceCacheFlushDate ? (
          <p>WSDOT cache marker: {freshness.sourceCacheFlushDate}</p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="pb-2 text-left font-bold">
              Full official fare table
            </caption>
            <thead>
              <tr>
                <th className="p-2" scope="col">
                  Fare
                </th>
                <th className="p-2" scope="col">
                  Category
                </th>
                <th className="p-2" scope="col">
                  Price (USD)
                </th>
                <th className="p-2" scope="col">
                  Collection applicability
                </th>
              </tr>
            </thead>
            <tbody>
              {/* preserve provider row order */}
              {fares.map((fare) => (
                <tr
                  className="border-t border-black/10 dark:border-white/10"
                  data-fare-id={fare.id}
                  key={fare.id}
                >
                  <th className="p-2 font-medium" scope="row">
                    {fare.label}
                  </th>
                  <td className="p-2">{fare.category}</td>
                  <td className="whitespace-nowrap p-2">
                    {currency.format(fare.amount)}
                  </td>
                  <td className="p-2">
                    {fare.directionIndependent
                      ? "Direction-independent"
                      : "Selected direction; collection rules apply"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
};
