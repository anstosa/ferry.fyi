import { FeedbackContent } from "./FeedbackContent";
import { Helmet } from "react-helmet";
import { Page } from "./Page";
import DonateIcon from "~/images/icons/solid/heart.svg";
import React, { ReactElement } from "react";

export const About = (): ReactElement => (
  <Page>
    <Helmet>
      <link rel="canonical" href={`${process.env.BASE_URL}/about`} />
    </Helmet>
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
      className="button button-invert flex-grow mt-4"
      rel="noreferrer"
    >
      <DonateIcon className="inline-block button-icon text-2xl" />
      <span className="button-label">Donate</span>
    </a>

    <FeedbackContent />
  </Page>
);
