import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SupporterUpgradeNudge } from "../../client/components/SupporterUpgradeNudge";

describe("SupporterUpgradeNudge", () => {
  // show one resolved upgrade path
  it("promotes the ad-free supporter upgrade to non-supporters", () => {
    const markup = renderToStaticMarkup(
      <SupporterUpgradeNudge
        active={false}
        heading="Enjoy leaderboards without ads"
        resolved
      />
    );

    expect(markup).toContain("Enjoy leaderboards without ads");
    expect(markup).toContain('href="/supporter"');
    expect(markup).toContain("Go ad-free");
  });

  // hide non-actionable states
  it("stays hidden while unresolved and after upgrading", () => {
    expect(
      renderToStaticMarkup(
        <SupporterUpgradeNudge active={false} resolved={false} />
      )
    ).toBe("");
    expect(
      renderToStaticMarkup(<SupporterUpgradeNudge active resolved={true} />)
    ).toBe("");
  });

  // use generic account copy by default
  it("supports an account-page upgrade prompt", () => {
    const markup = renderToStaticMarkup(
      <SupporterUpgradeNudge active={false} resolved />
    );

    expect(markup).toContain("Go ad-free with Ferry FYI Supporter");
  });
});
