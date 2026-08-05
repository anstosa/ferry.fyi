import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BarcodeOverlay } from "../../client/views/Tickets/BarcodeOverlay";
import { Ticket } from "../../client/views/Tickets/Ticket";
import type { TicketStorage } from "../../shared/contracts/tickets";

const placeholderTicket: TicketStorage = {
  addedAt: Date.UTC(2026, 7, 5, 12),
  codeFormat: "qr",
  id: "https://wave2go.wsdot.com/ticket/example",
  type: "ticket",
};

describe("unresolved ticket placeholders", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00Z"));
  });

  afterAll(() => vi.useRealTimers());

  it("does not guess a saved ticket product type", () => {
    const markup = renderToStaticMarkup(
      <Ticket onClick={() => undefined} ticket={placeholderTicket} />
    );

    expect(markup).toContain("WSF Ticket");
    expect(markup).toContain("Ticket details unavailable");
    expect(markup).toContain("Added today");
    expect(markup).not.toContain("Multi-Ride");
    expect(markup).not.toContain("Single-Ride");
  });

  it("shows a two-step manual lookup fallback for unresolved tickets", () => {
    const markup = renderToStaticMarkup(
      <BarcodeOverlay
        onClose={() => undefined}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
        ticket={placeholderTicket}
      />
    );

    expect(markup).toContain("WSF Ticket");
    expect(markup).toContain("Automatic ticket lookup failed");
    expect(markup).toContain("Added today");
    expect(markup).toContain("Copy ticket number");
    expect(markup).not.toContain("Copy your ticket number");
    expect(markup).not.toContain("Open WSF ticket lookup");
    expect(markup).not.toContain(">example</code>");
    expect(markup).toContain("Go to WSF ticket lookup");
    expect(markup).toContain("landingPage?c=76&amp;cg=21");
    expect(markup).toContain("border-blue-dark bg-blue-dark text-white");
    expect(markup).toContain("border-blue-medium bg-blue-lightest");
    expect(markup).toContain(
      "button border-red-dark bg-transparent text-red-dark"
    );
    expect(markup).not.toContain("Multi-Ride Pass");
  });
});
