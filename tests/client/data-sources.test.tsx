import React from "react";
import { HelmetProvider } from "react-helmet-async";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { DataSources } from "../../client/views/DataSources";
import { SEO_CONTENT_LAST_MODIFIED } from "../../shared/lib/seo";

describe("data sources editorial revision", () => {
  it("renders the shared SEO content revision as visible copy", () => {
    const html = renderToStaticMarkup(
      <HelmetProvider>
        <MemoryRouter>
          <DataSources />
        </MemoryRouter>
      </HelmetProvider>
    );

    expect(html).toContain(
      `<time dateTime="${SEO_CONTENT_LAST_MODIFIED}">July 29, 2026</time>`
    );
  });
});
