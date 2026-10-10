// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { Skeleton, SkeletonGroup } from "../../client/components/Skeleton";
import { TicketsPublicContent } from "../../client/views/TicketsPublicContent";

// inspect shared ticket content without storage or native integrations
const render = (
  props: React.ComponentProps<typeof TicketsPublicContent> = {}
): HTMLElement => {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(
    <MemoryRouter>
      <TicketsPublicContent {...props} />
    </MemoryRouter>
  );
  return page;
};

describe("ticket wallet introduction", () => {
  // remove only outer presentation and guidance rather than usable wallet tools
  it("renders an unboxed introduction without the wallet guidance card", () => {
    const page = render();
    const intro = page.querySelector("section");

    expect(page.textContent).toContain("Ferry tickets, ready to scan");
    expect(page.textContent).not.toContain("Using your ticket wallet");
    expect(page.textContent).not.toContain(
      "Open a saved ticket before boarding"
    );
    expect(intro?.className).toBe("mt-4 space-y-5");
    expect(intro?.querySelector(".absolute")).toBeNull();
    expect(page.textContent).toContain("Scan a ticket code");
    expect(page.textContent).toContain("Upload a ticket image");
    expect(page.textContent).toContain("Enter a code manually");
  });

  // rename the purchase action without changing its external destination
  it("links Buy Tickets to the existing WSF store", () => {
    const page = render();
    const links = [...page.querySelectorAll("a")];
    const purchase = links.find(
      (link) => link.textContent?.trim() === "Buy Tickets"
    );
    const reservation = links.find(
      (link) => link.textContent?.trim() === "Make a reservation"
    );

    expect(purchase?.href).toBe(
      "https://wave2go.wsdot.com/webstore/landingPage?cg=21&c=76"
    );
    expect(purchase?.target).toBe("_blank");
    expect(purchase?.rel).toBe("noreferrer");
    expect(purchase?.classList).toContain("button-secondary");
    expect(purchase?.classList).not.toContain("button-glass");
    expect(reservation?.href).toContain("reservations/vehicle/default.aspx");
    expect(page.textContent).not.toContain("Buy multi-ride passes");
  });

  // manual entry keeps its controls while removing purchase distractions
  it("preserves supplied wallet tools when purchase links are hidden", () => {
    const page = render({
      showPurchaseLinks: false,
      tools: <button type="button">Manual entry</button>,
    });

    expect(page.querySelector("button")?.textContent).toBe("Manual entry");
    expect(page.querySelectorAll("a")).toHaveLength(0);
    expect(page.textContent).not.toContain("Purchase tickets");
    expect(page.textContent).not.toContain("Scan a ticket code");
  });

  // server-rendered empty content remains outside the removed guidance card
  it("keeps the public empty wallet state as a separate section", () => {
    const page = render({ showEmptyState: true });
    const sections = [...page.querySelectorAll("section")];

    expect(sections).toHaveLength(2);
    expect(sections[1]?.textContent).toContain("No saved tickets yet");
    expect(sections[1]?.parentElement).toBe(sections[0]?.parentElement);
    expect(page.textContent).not.toContain("Using your ticket wallet");
    expect(render().textContent).not.toContain("No saved tickets yet");
  });

  // pending device controls must not hide static titles or purchase links
  it("keeps static content outside the pending tool region", () => {
    const page = render({
      tools: (
        <SkeletonGroup label="Loading ticket tools">
          <Skeleton className="h-16" />
        </SkeletonGroup>
      ),
    });
    const title = page.querySelector("h2");
    const purchase = [...page.querySelectorAll("a")].find(
      (link) => link.textContent?.trim() === "Buy Tickets"
    );

    expect(page.querySelectorAll(".skeleton")).toHaveLength(1);
    expect(title?.closest('[role="status"]')).toBeNull();
    expect(purchase?.closest('[role="status"]')).toBeNull();
  });
});
