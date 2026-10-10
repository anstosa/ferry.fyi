import React, { type ReactElement, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { FareRatesOverview } from "~/components/FareRatesOverview";
import { fareWizardIcons } from "~/components/FareWizardIcons";
import type { PlanningTerminal } from "~/components/RoutePlanningLinks";
import {
  type FareTravelMode,
  parseFareWizardConfig,
  withFareWizardConfig,
} from "~/lib/fareWizard";

// keep the linked calculator at the top without separating later results
export const CUSTOM_FARE_SECTION_CLASS =
  "scroll-mt-4 min-h-[calc(100dvh-8rem-var(--safe-area-inset-top)-var(--safe-area-inset-bottom))]";

interface FareLoadingContentProps {
  afterRates?: ReactNode;
  arrivingName: string;
  calculator?: ReactNode;
  departingName: string;
  mate?: { id: string };
  terminal?: PlanningTerminal;
  tripDate: string;
}

const loadingTravelModes = [
  ["vehicle", "Vehicle", fareWizardIcons.car],
  ["bicycle", "Bicycle", fareWizardIcons.bicycle],
  ["walk-on", "Walk on", fareWizardIcons.walking],
] as const;

// show the form's stable first step while its interactive bundle loads
const StaticFareCalculator = (): ReactElement => {
  const location = useLocation();
  const navigate = useNavigate();
  // persist a first-step choice through the router before the live module mounts
  const selectTravelMode = (travelMode: FareTravelMode): void => {
    const config = parseFareWizardConfig(location.search);
    const search = withFareWizardConfig(location.search, {
      ...config,
      travelMode,
    });
    navigate(
      {
        hash: location.hash,
        pathname: location.pathname,
        search: `?${search}`,
      },
      { replace: true, state: location.state }
    );
  };

  return (
    <section aria-label="Fare estimator">
      <h2 className="text-xl font-bold">Calculate a custom fare</h2>
      <p className="mt-1 text-sm">
        Choose passengers, vehicle size and eligible discounts. Ferry FYI uses
        official WSDOT fares and does not determine eligibility.
      </p>
      <fieldset className="mt-5">
        <legend className="text-lg font-bold">How are you traveling?</legend>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {/* keep stable choices usable before route-specific prices arrive */}
          {loadingTravelModes.map(([value, label, Icon]) => (
            <button
              className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-black/15 bg-white px-3 py-4 text-center font-medium transition hover:border-green-dark dark:border-white/20 dark:bg-black/20"
              key={value}
              onClick={() => selectTravelMode(value)}
              type="button"
            >
              <Icon aria-hidden="true" className="mb-2 h-10 w-10" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </fieldset>
    </section>
  );
};

// mirror the fare page while limiting placeholders to source-owned amounts
export const FareLoadingContent = ({
  afterRates,
  arrivingName,
  calculator,
  departingName,
  mate,
  terminal,
  tripDate,
}: FareLoadingContentProps): ReactElement => (
  <div className="space-y-4">
    <FareRatesOverview
      arrivingName={arrivingName}
      departingName={departingName}
      loadingTripDate={tripDate}
      mate={mate}
      terminal={terminal}
    />
    {afterRates}
    <div className={CUSTOM_FARE_SECTION_CLASS} id="custom-fare-calculator">
      {calculator ?? <StaticFareCalculator />}
    </div>
  </div>
);
