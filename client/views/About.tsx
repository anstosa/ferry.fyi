import React, { ReactElement } from "react";
import { Link } from "react-router-dom";
import { getSeoMetadata } from "shared/lib/seo";

import DonateIcon from "~/static/images/icons/solid/heart.svg";

import { AppVersionInfo } from "../components/AppVersionInfo";
import { Page } from "../components/Page";
import { SeoBreadcrumbs } from "../components/SeoBreadcrumbs";
import { SeoHelmet } from "../components/SeoHelmet";

const seo = getSeoMetadata("/about");

export const About = (): ReactElement => (
  <Page>
    <SeoHelmet seo={seo} />
    <SeoBreadcrumbs seo={seo} />
    <p className="mt-4">
      A ferry schedule and tracker for the greater Seattle area. Supports all{" "}
      <a
        className="link"
        href="https://www.wsdot.wa.gov/ferries/"
        target="_blank"
        rel="noopener noreferrer"
      >
        WSF
      </a>{" "}
      routes.
    </p>
    <p className="mt-4">
      Made with love by{" "}
      <a
        className="link"
        href="https://santosa.family/ansel"
        target="_blank"
        rel="noopener noreferrer"
      >
        Ansel Santosa
      </a>{" "}
      on Whidbey Island
    </p>

    <h2 className="font-bold text-lg mt-8">Support</h2>
    <p className="mt-2">
      If Ferry FYI is useful to you please consider making a tax-deductible
      donation to Ballydídean Farm Sanctuary to support animal welfare on
      Whidbey Island.
    </p>
    <a
      href="https://ballydiean.farm/donate"
      target="_blank"
      className="button button-primary flex-grow mt-4"
      rel="noreferrer"
    >
      <DonateIcon className="inline-block button-icon text-2xl" />
      <span className="button-label">Donate</span>
    </a>

    {/* credits attribution */}
    <h2 className="font-bold text-lg mt-8">Credits</h2>
    <p className="mt-2">
      Weather data and forecasts are provided by{" "}
      <a
        className="link"
        href="https://open-meteo.com/"
        target="_blank"
        rel="noopener noreferrer"
      >
        Open-Meteo
      </a>{" "}
      under{" "}
      <a
        className="link"
        href="https://creativecommons.org/licenses/by/4.0/"
        target="_blank"
        rel="noopener noreferrer"
      >
        CC BY 4.0
      </a>
      . Ferry FYI uses and summarizes this data for capacity forecasts.
    </p>

    <h2 className="font-bold text-lg mt-8">Privacy</h2>
    <p className="mt-2">
      Read the{" "}
      <Link className="link" to="/privacy">
        Privacy Policy
      </Link>
      .
    </p>
    <AppVersionInfo />
  </Page>
);
