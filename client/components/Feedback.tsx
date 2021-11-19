import { FeedbackContent } from "./FeedbackContent";
import { Helmet } from "react-helmet";
import { Page } from "./Page";
import React, { ReactElement } from "react";

export const Feedback = (): ReactElement => (
  <Page>
    <Helmet>
      <link rel="canonical" href={`${process.env.BASE_URL}/feedback`} />
    </Helmet>
    <FeedbackContent />
  </Page>
);
