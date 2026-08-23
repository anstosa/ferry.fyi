import React, { type ReactElement } from "react";
import { getSeoMetadata } from "shared/lib/seo";

import { Page } from "~/components/Page";
import { SeoHelmet } from "~/components/SeoHelmet";
import { SupporterCard } from "~/components/SupporterCard";

/** Public Supporter explanation and account-bound checkout page. */
export const Supporter = (): ReactElement => (
  <Page title="Ferry FYI Supporter">
    <SeoHelmet seo={getSeoMetadata("/supporter")} />
    <div className="mx-auto mt-6 max-w-3xl">
      <SupporterCard />
    </div>
  </Page>
);
