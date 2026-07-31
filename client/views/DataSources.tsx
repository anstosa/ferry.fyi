import React, { ReactElement } from "react";
import { Link } from "react-router-dom";
import { getSeoMetadata, SEO_CONTENT_LAST_MODIFIED } from "shared/lib/seo";

import { Page } from "../components/Page";
import { SeoHelmet } from "../components/SeoHelmet";

const seo = getSeoMetadata("/data-sources");

export const DataSources = (): ReactElement => (
  <Page title="Data sources and API guide">
    <SeoHelmet seo={seo} />
    <p className="mt-4">
      Ferry FYI is an independent trip-planning app. This page explains which
      data informs the app, how to interpret its freshness, and how to cite it
      accurately.
    </p>
    <p className="mt-2 text-sm text-gray-700 dark:text-gray-400">
      Methodology last reviewed{" "}
      <time dateTime={SEO_CONTENT_LAST_MODIFIED}>July 29, 2026</time>.
    </p>

    <h2 className="font-bold text-lg mt-8">Data sources and freshness</h2>
    <ul className="list-disc pl-5 mt-2 space-y-2">
      <li>
        <strong>Washington State Ferries service data:</strong> schedules,
        terminal relationships, vessel context, capacity reports, service
        bulletins, and camera metadata are refreshed as upstream information is
        available. This context originates with{" "}
        <a
          className="link"
          href="https://wsdot.wa.gov/travel/washington-state-ferries"
          rel="noopener noreferrer"
          target="_blank"
        >
          Washington State Ferries
        </a>
        . Its timestamps describe when the source was last observed, not a
        guarantee that conditions are unchanged.
      </li>
      <li>
        <strong>Weather:</strong> Ferry FYI uses forecast weather conditions to
        help explain future capacity estimates. Weather data is from{" "}
        <a
          className="link"
          href="https://open-meteo.com/"
          rel="noopener noreferrer"
          target="_blank"
        >
          Open-Meteo
        </a>
        .
      </li>
      <li>
        <strong>Tides:</strong> predicted tide conditions from{" "}
        <a
          className="link"
          href="https://tidesandcurrents.noaa.gov/"
          rel="noopener noreferrer"
          target="_blank"
        >
          NOAA
        </a>{" "}
        help identify low-tide cancellation risk on affected routes. A risk
        indication is not a confirmed cancellation.
      </li>
      <li>
        <strong>Ferry FYI forecasts:</strong> capacity and delay forecasts are
        Ferry FYI estimates derived from observed conditions, historical
        patterns, and forecast inputs. They are not an official boarding,
        reservation, delay, or cancellation decision.
      </li>
    </ul>

    <h2 className="font-bold text-lg mt-8">Citing Ferry FYI data</h2>
    <p className="mt-2">
      Cite the canonical route or terminal page for a human-readable summary,
      include the page&apos;s access time, and preserve the displayed freshness
      timestamp. For live claims, distinguish an observed value such as a
      capacity report or GPS delay from a predictive estimate.
    </p>
    <p className="mt-2">
      Link to this page when citing Ferry FYI&apos;s methodology or data limits,
      and to{" "}
      <Link className="link" to="/forecasting">
        Forecasting
      </Link>{" "}
      when explaining how vehicle-space, delay, weather, or tide-risk forecasts
      are produced.
    </p>

    <h2 className="font-bold text-lg mt-8">Public read-only API</h2>
    <p className="mt-2">
      Ferry FYI&apos;s public JSON API can provide current planning context. It
      is operational data rather than a stable third-party integration contract.
      Responses include a <code>body</code> payload and <code>wsfStatus</code>
      so callers can retain upstream availability and freshness context.
    </p>
    <ul className="list-disc pl-5 mt-2 space-y-2">
      <li>
        <code>GET /api/terminals</code> discovers terminal ids, route
        relationships, bulletins, and wait-time context.
      </li>
      <li>
        <code>GET /api/schedule/:departingId/:arrivingId/:YYYY-MM-DD</code>
        returns a route&apos;s sailings, observed crossing data, estimates,
        weather, tides, and vessel context for a service date.
      </li>
      <li>
        <code>GET /api/vessels</code> returns known vessel status and active
        GPS-delay signals when available.
      </li>
      <li>
        <code>GET /api/cameras/frames?ids=:commaSeparatedCameraIds</code>
        returns camera freshness and image metadata. Do not infer an exact queue
        length or boarding availability from an image.
      </li>
    </ul>

    <h2 className="font-bold text-lg mt-8">Corrections and limits</h2>
    <p className="mt-2">
      Conditions can change after a refresh. For an error, missing timestamp, or
      source question, use the{" "}
      <Link className="link" to="/feedback">
        Ferry FYI feedback page
      </Link>
      . Do not use a forecast or camera observation as proof of a confirmed
      sailing outcome.
    </p>
  </Page>
);
