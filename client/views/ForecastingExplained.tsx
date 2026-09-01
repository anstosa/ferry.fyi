import React, { ReactElement } from "react";
import { Link } from "react-router-dom";
import { getSeoMetadata } from "shared/lib/seo";

import { Page } from "../components/Page";
import { SeoHelmet } from "../components/SeoHelmet";

const seo = getSeoMetadata("/forecasting");

// forecasting explainer page
export const ForecastingExplained = (): ReactElement => (
  <Page title="Forecasting">
    <SeoHelmet seo={seo} />
    <p className="mt-4">
      Ferry FYI forecasts estimate vehicle space, schedule delay, and tidal
      cancellation risk for upcoming sailings. They are meant to help you
      compare options, not to replace official Washington State Ferries status,
      route alerts, or terminal signs.
    </p>
    <p className="mt-2">
      For source freshness and citation guidance, see Ferry FYI&apos;s{" "}
      <Link className="link" to="/data-sources">
        data sources and API guide
      </Link>
      .
    </p>

    <h2 className="font-bold text-lg mt-8">
      What goes into a capacity forecast?
    </h2>
    <ul className="list-disc pl-5 mt-2 space-y-2">
      <li>
        <strong>Current WSF capacity reports:</strong> when WSF reports live
        space counts, those numbers anchor the estimate.
      </li>
      <li>
        <strong>Similar past sailings:</strong> the model compares each sailing
        with the last 2 years of sailings on the same route, near the same time
        of day, and on similar days of the week.
      </li>
      <li>
        <strong>Recent direction-specific demand:</strong> when enough completed
        sailings show that one direction has become consistently busier or
        quieter than its established pattern, the model can adjust upcoming
        sailings in that direction. The adjustment fades for sailings farther in
        the future and is limited so a short-term pattern cannot overwhelm the
        historical forecast.
      </li>
      <li>
        <strong>Calendar patterns:</strong> holidays, seasonality, recency, and
        daylight all influence which historical sailings are most comparable.
      </li>
      <li>
        <strong>Service conditions:</strong> cancellations and major disruptions
        are handled separately so the forecast does not pretend a disrupted
        sailing is normal.
      </li>
      <li>
        <strong>Weather:</strong> upcoming temperature, cloud cover, wind, and
        precipitation can nudge the estimate up or down when historical data
        shows that similar weather affected traffic on that route.
      </li>
    </ul>

    <p className="mt-4">
      A future sailing may briefly show every vehicle space available before WSF
      starts actively reporting capacity. Ferry FYI treats that initial all-open
      value as unavailable evidence instead of assuming the terminal is empty.
      Once live reporting begins, fresh WSF counts remain the strongest input.
    </p>
    <p className="mt-2">
      When fewer than 10 percent of vehicle spaces are forecast to remain, Ferry
      FYI shows the forecast as full instead of displaying a specific number of
      spaces. The calibrated chance that the sailing will fill completely
      remains visible separately. Forecasts with a likely or high calibrated
      full risk are also shown as full.
    </p>

    <h2 className="font-bold text-lg mt-8">How delay forecasts work</h2>
    <p className="mt-2">
      Delay forecasts follow the vessel, not just one terminal. If a boat is
      late leaving or arriving on one side of the route, that same delay carries
      into the next crossing for that boat.
    </p>
    <ul className="list-disc pl-5 mt-2 space-y-2">
      <li>
        <strong>GPS progress:</strong> when a live vessel position matches the
        scheduled crossing, Ferry FYI compares the boat&apos;s progress across
        the route with where it should be on the schedule.
      </li>
      <li>
        <strong>Prior crossings:</strong> the projected delay for a future
        sailing starts with the previous crossing by that same vessel.
      </li>
      <li>
        <strong>Recovery factors:</strong> sailing length, vessel speed
        capability, and how full the prior crossing was can affect how quickly a
        boat may recover delay. Boats are never projected to depart before the
        scheduled time.
      </li>
    </ul>

    <h2 className="font-bold text-lg mt-8">
      How tidal cancellation risk works
    </h2>
    <p className="mt-2">
      Tidal cancellation risk combines NOAA tide forecasts with routes where WSF
      has historically cancelled sailings at very low tide levels. For confirmed
      cancellations, Ferry FYI shows WSF&apos;s cancellation state. For future
      sailings that are not yet cancelled, Ferry FYI flags likely tidal
      cancellation risk when the predicted tide falls below the route&apos;s
      risk threshold.
    </p>

    <h2 className="font-bold text-lg mt-8">Why confidence changes</h2>
    <p className="mt-2">
      Confidence is higher when there is recent, relevant historical data and a
      live WSF report, GPS match, or current tide forecast. It is lower when a
      route has sparse history, unusual timing, disruptions, or missing
      supporting data.
    </p>
  </Page>
);
