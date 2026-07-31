import React, { ReactElement, useInsertionEffect } from "react";
import { Helmet } from "react-helmet-async";
import {
  getSeoProfile,
  getSeoSchema,
  getSeoUrl,
  type SeoMetadata,
} from "shared/lib/seo";

import { useAppRenderContext } from "../lib/renderContext";
import { removeSeedSeoTags } from "../lib/seo";

interface Props {
  seo: SeoMetadata;
  title?: string;
}

export const SeoHelmet = ({
  seo,
  title: titleOverride,
}: Props): ReactElement => {
  const { hasInjectedRequest, seoBaseUrl, seoHost, seoPathname } =
    useAppRenderContext();
  useInsertionEffect(() => {
    if (typeof document !== "undefined") {
      removeSeedSeoTags();
    }
  }, []);

  const browserHost =
    hasInjectedRequest || typeof location === "undefined" ? "" : location.host;
  const browserPathname =
    hasInjectedRequest || typeof location === "undefined"
      ? "/"
      : location.pathname;
  const profile = getSeoProfile(
    seoHost || browserHost,
    seoPathname || browserPathname
  );
  let activeSeo = seo;
  if (seo.canonicalPath !== "/404" && profile.baseUrl) {
    activeSeo = profile.metadata;
  }
  const title = profile.baseUrl
    ? activeSeo.title
    : (titleOverride ?? activeSeo.title);
  const baseUrl = profile.baseUrl ?? (seoBaseUrl || process.env.BASE_URL || "");
  const canonicalUrl = getSeoUrl(baseUrl, activeSeo.canonicalPath);
  const schema = getSeoSchema(activeSeo, baseUrl, title);

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
