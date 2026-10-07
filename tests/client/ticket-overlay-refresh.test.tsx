// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canShare: vi.fn(() => Promise.resolve({ value: false })),
  share: vi.fn(() => Promise.resolve()),
  trackUsefulEvent: vi.fn(),
}));

vi.mock("@capacitor/share", () => ({
  Share: {
    canShare: mocks.canShare,
    share: mocks.share,
  },
}));
vi.mock("@zxing/browser", () => ({
  BrowserQRCodeSvgWriter: class {
    write(): SVGSVGElement {
      return document.createElementNS("http://www.w3.org/2000/svg", "svg");
    }
  },
}));
vi.mock("~/lib/analytics", () => ({
  trackUsefulEvent: mocks.trackUsefulEvent,
}));

import { BarcodeOverlay } from "../../client/views/Tickets/BarcodeOverlay";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;

// restore default native share behavior
beforeEach(() => {
  mocks.canShare.mockResolvedValue({ value: false });
  mocks.share.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("ticket overlay refresh", () => {
  it("refreshes a ticket once when the popup opens", async () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <BarcodeOverlay
          onClose={vi.fn()}
          onDelete={vi.fn()}
          onRefresh={onRefresh}
          ticket={{
            codeFormat: "qr",
            id: "ticket-1",
            sourceUpdatedAt: 1,
            type: "ticket",
          }}
        />
      );
      await Promise.resolve();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      root?.render(
        <BarcodeOverlay
          onClose={vi.fn()}
          onDelete={vi.fn()}
          onRefresh={onRefresh}
          ticket={{
            codeFormat: "qr",
            id: "ticket-1",
            sourceUpdatedAt: 2,
            type: "ticket",
          }}
        />
      );
      await Promise.resolve();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows an in-progress state instead of a lookup failure while refreshing", async () => {
    let finishRefresh: (() => void) | undefined;
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        })
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <BarcodeOverlay
          onClose={vi.fn()}
          onDelete={vi.fn()}
          onRefresh={onRefresh}
          ticket={{ codeFormat: "qr", id: "ticket-1", type: "ticket" }}
        />
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Refreshing ticket details…");
    expect(container.textContent).not.toContain(
      "Automatic ticket lookup failed"
    );
    expect(
      container.querySelector('[role="status"] .animate-spin')
    ).not.toBeNull();

    await act(async () => {
      finishRefresh?.();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Refreshing ticket details…");
    expect(container.textContent).toContain("Automatic ticket lookup failed");
  });

  it("turns the copy action green and shows a check after copying", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <BarcodeOverlay
          onClose={vi.fn()}
          onDelete={vi.fn()}
          ticket={{
            codeFormat: "qr",
            id: "VisualID=ticket-1&foo=bar",
            type: "ticket",
          }}
        />
      );
      await Promise.resolve();
    });

    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy ticket number"]'
    );
    expect(copyButton).not.toBeNull();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith("ticket-1");
    const copiedButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Ticket number copied"]'
    );
    expect(copiedButton?.textContent).toContain("Ticket number copied");
    expect(copiedButton?.className).toContain("bg-green-dark");
    expect(
      copiedButton?.querySelector(".ticket-copy-check-icon")
    ).not.toBeNull();
  });

  // keep ticket utility sharing outside rider sharing analytics
  it("shares a ticket without qualifying rider sharing analytics", async () => {
    mocks.canShare.mockResolvedValue({ value: true });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <BarcodeOverlay
          onClose={vi.fn()}
          onDelete={vi.fn()}
          ticket={{ codeFormat: "qr", id: "ticket-1", type: "ticket" }}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const shareButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Share"
    );
    expect(shareButton).toBeDefined();

    await act(async () => {
      shareButton?.click();
      await Promise.resolve();
    });

    expect(mocks.share).toHaveBeenCalledWith({
      dialogTitle: "WSF Ticket",
      text: "WSF Ticket",
      title: "Shared Ticket on Ferry FYI",
      url: `${process.env.BASE_URL}/tickets?add=ticket-1&format=qr`,
    });
    expect(mocks.trackUsefulEvent).not.toHaveBeenCalled();
  });
});
