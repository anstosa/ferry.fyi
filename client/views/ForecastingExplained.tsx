import React, { ReactElement } from "react";
import { Helmet } from "react-helmet-async";

import { Page } from "../components/Page";

// forecasting explainer page
export const ForecastingExplained = (): ReactElement => (
  <Page title="Forecasting Explained">
    <Helmet>
      <link
        rel="canonical"
        href={`${process.env.BASE_URL}/forecasting-explained`}
      />
    </Helmet>

    <p className="mt-4">
      Ferry FYI forecasts are estimates of how much vehicle space may still be
      available on upcoming sailings. They are meant to help you compare
      options, not to replace official Washington State Ferries status or
      terminal signs.
    </p>

    <h2 className="font-bold text-lg mt-8">What goes into a forecast?</h2>
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

    <h2 className="font-bold text-lg mt-8">Why confidence changes</h2>
    <p className="mt-2">
      Confidence is higher when there is recent, relevant historical data and a
      live WSF report. It is lower when a route has sparse history, unusual
      timing, disruptions, or missing supporting data.
    </p>
  </Page>
);
