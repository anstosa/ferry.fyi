import React from "react";
import { HelmetProvider } from "react-helmet-async";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ForecastingExplained } from "../../client/views/ForecastingExplained";

describe("forecasting explanation", () => {
  // demand-model explanation
  it("explains directional demand and initial all-open reports", () => {
    const html = renderToStaticMarkup(
      <HelmetProvider>
        <MemoryRouter>
          <ForecastingExplained />
        </MemoryRouter>
      </HelmetProvider>
    );

    expect(html).toContain("Recent direction-specific demand");
    expect(html).toContain("upcoming sailings in that direction");
    expect(html).toContain("starts actively reporting capacity");
    expect(html).toContain("fresh WSF counts remain the strongest input");
    expect(html).toContain("fewer than 10 percent");
    expect(html).toContain("shows the forecast as full");
    expect(html).toContain("fill completely");
    expect(html).toContain("likely or high calibrated");
    expect(html).toContain("specific number of spaces");
  });
});
