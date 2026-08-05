// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;

// find confirmation dialog
const getDialog = (container: HTMLElement): HTMLElement => {
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]');

  // missing dialog guard
  if (!dialog) {
    throw new Error("Could not find confirmation dialog");
  }
  return dialog;
};

// find confirmation control
const getConfirmButton = (dialog: HTMLElement): HTMLButtonElement => {
  const button = dialog.querySelector<HTMLButtonElement>(
    'button[aria-label="Confirm removal"]'
  );

  // missing control guard
  if (!button) {
    throw new Error("Could not find removal confirmation");
  }
  return button;
};

// render ticket overlay
const renderOverlay = async (
  container: HTMLElement,
  onDelete: () => Promise<void>,
  onClose = vi.fn()
): Promise<void> => {
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <BarcodeOverlay
        onClose={onClose}
        onDelete={onDelete}
        ticket={{ codeFormat: "qr", id: "ticket-1", type: "ticket" }}
      />
    );
    await Promise.resolve();
  });
};

// open removal confirmation
const openRemovalConfirmation = (container: HTMLElement): void => {
  const removeButton = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Remove saved item"]'
  );

  // missing removal guard
  if (!removeButton) {
    throw new Error("Could not find saved item removal");
  }
  act(() => removeButton.click());
};

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ticket overlay deletion", () => {
  // verify retryable deletion failure
  it("keeps the confirmation open and allows retry after deletion fails", async () => {
    const failure = new Error("metadata update failed");
    const onDelete = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await renderOverlay(container, onDelete, onClose);
    openRemovalConfirmation(container);

    await act(async () => {
      getConfirmButton(getDialog(container)).click();
      await Promise.resolve();
    });

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    const retryDialog = getDialog(container);
    expect(retryDialog.getAttribute("aria-modal")).toBe("true");
    expect(retryDialog.querySelector('[role="alert"]')).not.toBeNull();
    expect(getConfirmButton(retryDialog).disabled).toBe(false);

    await act(async () => {
      getConfirmButton(retryDialog).click();
      await Promise.resolve();
    });

    expect(onDelete).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  // verify pending deletion lock
  it("keeps confirmation open and blocks duplicate deletion while pending", async () => {
    let finishDelete: (() => void) | undefined;
    const onDelete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = resolve;
        })
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderOverlay(container, onDelete);
    openRemovalConfirmation(container);

    await act(async () => {
      getConfirmButton(getDialog(container)).click();
      await Promise.resolve();
    });

    const pendingDialog = getDialog(container);
    const pendingButton = getConfirmButton(pendingDialog);
    expect(pendingButton.disabled).toBe(true);
    expect(pendingDialog).not.toBeNull();
    pendingButton.click();
    expect(onDelete).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishDelete?.();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
