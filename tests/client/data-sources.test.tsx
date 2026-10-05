import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { DataSources } from "../../client/views/DataSources";
import {
  getSeoMetadata,
  getSeoSchema,
  SEO_CONTENT_LAST_MODIFIED,
} from "../../shared/lib/seo";

describe("data sources editorial revision", () => {
  // keep page and dataset metadata aligned with the public policy revision
  it("publishes the substantive October content revision", () => {
    expect(SEO_CONTENT_LAST_MODIFIED).toBe("2026-10-05");
    const schema = getSeoSchema(
      getSeoMetadata("/data-sources"),
      "https://ferry.fyi"
    );
    expect(schema["@graph"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          "@type": "WebPage",
          dateModified: "2026-10-05",
        }),
        expect.objectContaining({
          "@type": "Dataset",
          dateModified: "2026-10-05",
        }),
      ])
    );
  });

  // keep the human label and machine date in one revision
  it("renders the shared SEO content revision as visible copy", () => {
    const html = renderToStaticMarkup(
      <HelmetProvider>
        <MemoryRouter>
          <DataSources />
        </MemoryRouter>
      </HelmetProvider>
    );

    expect(html).toContain(
      `<time dateTime="${SEO_CONTENT_LAST_MODIFIED}">October 5, 2026</time>`
    );
  });
});
