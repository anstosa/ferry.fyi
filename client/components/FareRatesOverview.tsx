import { DateTime } from "luxon";
import React, { type ReactElement } from "react";
import type {
  FareCurrentCatalogResponse,
  FareDefaultRate,
  FareDefaultRateComparison,
  FareNoFareResponse,
} from "shared/contracts/fares";

import { RoutePageIntro } from "~/components/RoutePageIntro";
import {
  type PlanningTerminal,
  RoutePlanningLinks,
} from "~/components/RoutePlanningLinks";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";

const currency = new Intl.NumberFormat("en-US", {
  currency: "USD",
  style: "currency",
});
const EMPTY_COMPARISON: FareDefaultRateComparison = {
  oneWay: null,
  roundTrip: null,
};

// retain each official amount's stale and unavailable state without source copy
const Price = ({
  label,
  loading = false,
  rate,
}: {
  label: string;
  loading?: boolean;
  rate: FareDefaultRate | null;
}): ReactElement => {
  const price = rate ? currency.format(rate.amount) : "Unavailable";
  return (
    <div className="min-w-0 rounded-xl bg-gray-50 p-3 dark:bg-white/5">
      <p className="text-sm font-semibold">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-24" variant="text" />
      ) : (
        <p
          className={
            rate
              ? "mt-1 text-2xl font-bold tabular-nums sm:text-3xl"
              : "mt-1 text-sm font-semibold"
          }
        >
          {/* only explicit zero amounts are free; missing prices remain unavailable */}
          {rate?.amount === 0 ? "Free" : price}
        </p>
      )}
      {/* stale is never silently relabeled as a current fare */}
      {!loading && rate?.state === "stale" && (
        <p className="mt-1 text-xs font-bold text-red-dark dark:text-red-200">
          Stale fare · verify with WSDOT
        </p>
      )}
      {!loading && rate?.state === "no-fare" && (
        <p className="mt-1 text-xs">No fare collected</p>
      )}
    </div>
  );
};

// reuse truthful trip labels for the default rates and a custom estimate
export const FarePriceComparison = ({
  comparison,
  loading = false,
  loadingLabel = "Loading fare prices",
}: {
  comparison?: FareDefaultRateComparison;
  loading?: boolean;
  loadingLabel?: string | null;
}): ReactElement => {
  const prices = (
    <>
      <Price
        label="One way"
        loading={loading}
        rate={comparison?.oneWay ?? null}
      />
      <Price
        label="Round trip"
        loading={loading}
        rate={comparison?.roundTrip ?? null}
      />
    </>
  );
  // announce only the unknown amounts while their labels remain readable
  if (loading && loadingLabel) {
    return (
      <SkeletonGroup
        className="mt-4 grid grid-cols-2 gap-3"
        label={loadingLabel}
      >
        {prices}
      </SkeletonGroup>
    );
  }
  return <div className="mt-4 grid grid-cols-2 gap-3">{prices}</div>;
};

interface FareRatesOverviewBaseProps {
  arrivingName: string;
  departingName: string;
  mate?: { id: string };
  terminal?: PlanningTerminal;
}

type FareRatesOverviewProps = FareRatesOverviewBaseProps &
  (
    | {
        loadingTripDate: string;
        response?: never;
      }
    | {
        loadingTripDate?: never;
        response: FareCurrentCatalogResponse | FareNoFareResponse;
      }
  );

// answer common fare questions before requiring a custom configuration
export const FareRatesOverview = ({
  response,
  departingName,
  arrivingName,
  loadingTripDate,
  mate,
  terminal,
}: FareRatesOverviewProps): ReactElement => {
  let source = null;
  // select the request-bearing source without weakening unavailable semantics
  if (response?.state === "current") {
    source = response.catalog;
  } else if (response?.state === "no-fare") {
    source = response.noFare;
  }
  const tripDate = source?.request.tripDate ?? loadingTripDate ?? "";
  const date = DateTime.fromISO(tripDate, {
    zone: "America/Los_Angeles",
  });
  // only an explicit no-fare response establishes a zero departure price
  const fallback =
    response?.state === "no-fare"
      ? {
          oneWay: {
            amount: 0,
            freshness: response.noFare.freshness,
            state: "no-fare" as const,
          },
          roundTrip: null,
        }
      : EMPTY_COMPARISON;
  const isLoading = !response;
  const rateSections = (
    <>
      <section aria-labelledby="fare-passenger-heading" className="min-w-0">
        <h2 className="text-lg font-bold" id="fare-passenger-heading">
          Passenger
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          One adult walk-on · ages 19–64
        </p>
        <FarePriceComparison
          comparison={response?.defaultRates?.passenger ?? fallback}
          loading={isLoading}
          loadingLabel={null}
        />
      </section>
      <section aria-labelledby="fare-vehicle-heading" className="min-w-0">
        <h2 className="text-lg font-bold" id="fare-vehicle-heading">
          Standard vehicle &amp; driver
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Vehicle under 22 ft · one full-fare driver · no extra passengers
        </p>
        <FarePriceComparison
          comparison={response?.defaultRates?.standardVehicle ?? fallback}
          loading={isLoading}
          loadingLabel={null}
        />
      </section>
    </>
  );

  return (
    <section aria-labelledby="fare-rates-heading" className="space-y-4">
      <div>
        <RoutePageIntro
          id="fare-rates-heading"
          title={`${departingName} to ${arrivingName} ferry fares`}
          description={
            <>
              Rates for{" "}
              <time dateTime={tripDate}>{date.toFormat("MMMM d, yyyy")}</time>
            </>
          }
        />
      </div>

      {isLoading ? (
        <SkeletonGroup
          className="grid gap-4 md:grid-cols-2"
          label="Loading fare prices"
        >
          {rateSections}
        </SkeletonGroup>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">{rateSections}</div>
      )}

      {/* preserve policy explanations without claiming a free round trip */}
      {response?.state === "no-fare" && (
        <p className="px-1 text-sm">
          {response.noFare.message ?? "No fare is collected in this direction."}{" "}
          The return journey may still have a fare.
        </p>
      )}

      {/* place the static planning buttons after rates and before the page ad */}
      <RoutePlanningLinks
        currentView="fare"
        mate={mate}
        selectedDate={tripDate}
        terminal={terminal}
      />
    </section>
  );
};
