import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { PrivacyPolicy } from "../../client/views/PrivacyPolicy";

describe("privacy and advertising policy", () => {
  it("keeps contextual advertising outside personal and safety-sensitive data", () => {
    const html = renderToStaticMarkup(
      <HelmetProvider>
        <MemoryRouter>
          <PrivacyPolicy />
        </MemoryRouter>
      </HelmetProvider>
    );

    expect(html).toContain('<time dateTime="2026-08-05">August 5, 2026</time>');
    expect(html).toContain("cached with the account");
    expect(html).toContain("a ticket looked up");
    expect(html).toContain("Removing a saved ticket removes its");
    expect(html).toContain("Advertising interactions");
    expect(html).toContain(
      "We do not provide advertisers with personal information"
    );
    expect(html).toContain("We do not sell personal information");
    expect(html).toContain("saved-ticket or barcode screens");
    expect(html).toContain("service alerts, or push notifications");
  });

  it("states the advertising disclosure and acceptance rules", () => {
    const html = renderToStaticMarkup(
      <HelmetProvider>
        <MemoryRouter>
          <PrivacyPolicy />
        </MemoryRouter>
      </HelmetProvider>
    );

    expect(html).toContain("Advertising and sponsorship policy");
    expect(html).toContain("Advertisements are labeled");
    expect(html).toContain("political candidate, party, ballot measure");
    expect(html).toContain("resemble official ferry alerts");
    expect(html).toContain("may reject, pause, or remove an advertisement");
  });
});
