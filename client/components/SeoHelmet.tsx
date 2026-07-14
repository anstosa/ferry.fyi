import React, { ReactElement, useInsertionEffect } from "react";
import { Helmet } from "react-helmet-async";
import {
  getSeoProfile,
  getSeoUrl,
  SEO_APP_NAME,
  type SeoMetadata,
} from "shared/lib/seo";

import { removeSeedSeoTags } from "../lib/seo";

interface Props {
  seo: SeoMetadata;
  title?: string;
}

export const SeoHelmet = ({
  seo,
  title: titleOverride,
}: Props): ReactElement => {
  useInsertionEffect(removeSeedSeoTags, []);

  const profile = getSeoProfile(location.host, location.pathname);
  const activeSeo = profile.baseUrl ? profile.metadata : seo;
  const title = profile.baseUrl
    ? activeSeo.title
    : (titleOverride ?? activeSeo.title);
  const baseUrl = profile.baseUrl ?? process.env.BASE_URL ?? "";
  const canonicalUrl = getSeoUrl(baseUrl, activeSeo.canonicalPath);
  const schema = {
    ...activeSeo.schema,
    name: title,
    url: canonicalUrl,
    isPartOf: {
      "@type": "WebSite",
      name: SEO_APP_NAME,
      url: getSeoUrl(baseUrl, "/"),
    },
  };

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={activeSeo.description} />
      <meta name="robots" content={activeSeo.robots} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={activeSeo.description} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={activeSeo.description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta itemProp="name" content={title} />
      <meta itemProp="description" content={activeSeo.description} />
      <link rel="canonical" href={canonicalUrl} />
      <script type="application/ld+json">{JSON.stringify(schema)}</script>
    </Helmet>
  );
};
