import React, { type ReactElement } from "react";
import { getSeoMetadata } from "shared/lib/seo";

import EmailIcon from "~/static/images/icons/solid/envelope.svg";

import { Page } from "../components/Page";
import { SeoHelmet } from "../components/SeoHelmet";

/** support contact content */
const Content = (): ReactElement => (
  <>
    <p className="mt-8">
      Have a question, found an issue, or want to share an idea? We&apos;re
      happy to help.
    </p>
    <p className="mt-3">
      Send an email with any helpful details, such as the route or terminal you
      were viewing, what you expected to happen, and the device you were using.
    </p>
    <div className="flex mt-5">
      <a
        className="button button-primary flex-grow"
        href="mailto:dev@ferry.fyi?subject=Ferry%20FYI%20support"
        target="_blank"
        rel="noopener noreferrer"
      >
        <EmailIcon className="inline-block button-icon text-2xl" />
        <span className="button-label">Email Support</span>
      </a>
    </div>
  </>
);

/** support page */
export const Support = (): ReactElement => (
  <Page title="Support">
    <SeoHelmet seo={getSeoMetadata("/support")} />
    <Content />
  </Page>
);
