// @vitest-environment jsdom

import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@capacitor/share", () => ({
  Share: {
    canShare: vi.fn(() => Promise.resolve({ value: false })),
    share: vi.fn(),
  },
}));
vi.mock("@zxing/browser", () => ({
  BrowserQRCodeSvgWriter: class {
    // render test QR
    write(): SVGSVGElement {
      return document.createElementNS("http://www.w3.org/2000/svg", "svg");
    }
  },
}));

import { BarcodeOverlay } from "../../client/views/Tickets/BarcodeOverlay";
import { Ticket } from "../../client/views/Tickets/Ticket";
import type { TicketStorage } from "../../shared/contracts/tickets";

const placeholderTicket: TicketStorage = {
  addedAt: Date.UTC(2026, 7, 5, 12),
  codeFormat: "qr",
  id: "https://wave2go.wsdot.com/ticket/example",
  type: "ticket",
};

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;

// render ticket surface
const renderSurface = async (
  container: HTMLElement,
  element: ReactElement
): Promise<void> => {
  root = createRoot(container);
  await act(async () => {
    root?.render(element);
    await Promise.resolve();
  });
};

describe("unresolved ticket placeholders", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00Z"));
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  afterAll(() => vi.useRealTimers());

  // verify neutral product semantics
  it("does not guess a saved ticket product type", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderSurface(
      container,
      <Ticket onClick={() => undefined} ticket={placeholderTicket} />
    );

    const ticketButton = container.querySelector("button");
    expect(ticketButton?.textContent).toContain("WSF Ticket");
    expect(ticketButton?.textContent).toContain("Ticket details unavailable");
    expect(ticketButton?.textContent).toContain("Added today");
    expect(ticketButton?.textContent).not.toContain("Multi-Ride");
    expect(ticketButton?.textContent).not.toContain("Single-Ride");
  });

  // verify manual lookup controls
  it("shows an accessible two-step manual lookup fallback", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderSurface(
      container,
      <BarcodeOverlay
        onClose={() => undefined}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
        ticket={placeholderTicket}
      />
    );

    const fallback = container.querySelector(
      'section[aria-labelledby="ticket-lookup-error-title"]'
    );
    const copyButton = fallback?.querySelector(
      'button[aria-label="Copy ticket number"]'
    );
    const lookupLink = fallback?.querySelector<HTMLAnchorElement>("a");

    expect(fallback).not.toBeNull();
    expect(copyButton).not.toBeNull();
    expect(lookupLink?.href).toBe(
      "https://wave2go.wsdot.com/webstore/landingPage?c=76&cg=21"
    );
    expect(lookupLink?.target).toBe("_blank");
    expect(lookupLink?.rel).toBe("noreferrer");
    expect(
      container.querySelector('[aria-label="Remove saved item"]')
    ).not.toBeNull();
  });
});
