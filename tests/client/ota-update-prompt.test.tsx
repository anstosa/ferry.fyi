// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OtaUpdateState } from "../../client/lib/ota";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  initialize: vi.fn(),
}));

vi.mock("../../client/lib/ota", () => ({
  applyOtaUpdate: mocks.apply,
  initializeOtaUpdater: mocks.initialize,
}));
vi.mock("framer-motion", () => ({ motion: { div: "div" } }));

import { OtaUpdatePrompt } from "../../client/components/OtaUpdatePrompt";
import { Prompt } from "../../client/components/Prompt";

let root: Root | undefined;

// render the real notification shell and its queue
const renderPrompt = async (
  footerDocked = false,
  refreshError = false
): Promise<HTMLDivElement> => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <>
        <Prompt footerDocked={footerDocked} level="warning">
          Your device is offline
        </Prompt>
        {refreshError && (
          <Prompt level="error">Could not refresh the schedule</Prompt>
        )}
        <OtaUpdatePrompt footerDocked={footerDocked} />
      </>
    );
  });
  return container;
};

// deliver the updater's public state callback
const reportState = async (state: OtaUpdateState): Promise<void> => {
  await act(async () =>
    mocks.initialize.mock.calls.at(-1)?.[0].onStateChange(state)
  );
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.initialize.mockResolvedValue("native-unavailable");
  mocks.apply.mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OtaUpdatePrompt", () => {
  // browser and current bundles do not produce OTA notices
  it("stays hidden when no update is available", async () => {
    const container = await renderPrompt();
    expect(container.textContent).not.toContain("Ferry FYI update");
    expect(container.textContent).toContain("Your device is offline");
  });

  // active updates stay visible without hiding operational warnings
  it("shows a persistent bottom notice with real progress above the footer", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(150);
    const container = await renderPrompt(true);
    await reportState({ status: "downloading", progress: 42 });

    expect(container.textContent).toContain(
      "An Ferry FYI update is downloading"
    );
    expect(container.textContent).toContain("42%");
    expect(container.textContent).toContain("Your device is offline");
    const progress = container.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute("aria-valuenow")).toBe("42");
    expect(progress?.getAttribute("aria-valuemax")).toBe("100");
    expect(progress?.firstElementChild?.getAttribute("style")).toContain("42%");
    const otaNotice = progress?.closest(".alert");
    expect(otaNotice?.className).toContain("bottom-0");
    expect(otaNotice?.className).toContain(
      "var(--route-footer-height)+var(--safe-area-inset-bottom)"
    );
    expect(container.querySelector(".alert__close")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(
      container.querySelector<HTMLDivElement>(".alert--warning")?.style
        .marginBottom
    ).toContain("150px + var(--toast-stack-gap)");

    await reportState({ status: "downloading", progress: 100 });
    expect(container.querySelector("button")).toBeNull();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  // completed staging offers an explicit reload and prevents repeated clicks
  it("applies the downloaded bundle only when reload is clicked", async () => {
    const container = await renderPrompt();
    await reportState({ status: "ready", bundleId: "bundle-2" });
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.querySelector(".alert__close")).toBeNull();
    expect(mocks.apply).not.toHaveBeenCalled();

    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Reload to apply");
    await act(async () => button?.click());
    expect(mocks.apply).toHaveBeenCalledExactlyOnceWith();
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toBe("Reloading…");
    await act(async () => button?.click());
    expect(mocks.apply).toHaveBeenCalledOnce();
  });

  // activation errors retain the staged update for retry
  it("keeps a reload retry available after activation fails", async () => {
    mocks.apply.mockRejectedValueOnce(new Error("cannot apply"));
    const container = await renderPrompt();
    await reportState({ status: "ready", bundleId: "bundle-2" });
    await act(async () => container.querySelector("button")?.click());
    expect(container.textContent).toContain("The update could not be applied");
    expect(container.querySelector("button")?.disabled).toBe(false);
    await act(async () => container.querySelector("button")?.click());
    expect(mocks.apply).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("could not be applied");
  });

  // persistent notices must not obscure safety-relevant errors
  it("keeps refresh errors visible alongside the update", async () => {
    const container = await renderPrompt(true, true);
    await reportState({ status: "ready", bundleId: "bundle-2" });
    expect(container.textContent).toContain("Could not refresh the schedule");
    expect(container.textContent).toContain(
      "A Ferry FYI update is ready to apply"
    );
    expect(container.textContent).not.toContain("Your device is offline");
    expect(container.querySelectorAll(".alert")).toHaveLength(2);
  });

  // failed transfers never masquerade as complete
  it("retries a failed download", async () => {
    const container = await renderPrompt();
    await reportState({ status: "failed" });
    let finishRetry: ((result: "queued") => void) | undefined;
    // retain the pending native check until its state events finish
    const retry = new Promise<"queued">((resolve) => {
      finishRetry = resolve;
    });
    mocks.initialize.mockReturnValueOnce(retry);
    expect(container.textContent).toContain("could not download");
    expect(container.querySelector("button")?.textContent).toBe(
      "Retry download"
    );
    await act(async () => container.querySelector("button")?.click());
    expect(mocks.initialize).toHaveBeenCalledTimes(2);
    const checkingButton = container.querySelector("button");
    expect(checkingButton?.textContent).toBe("Checking for update…");
    expect(checkingButton?.disabled).toBe(true);
    await act(async () => checkingButton?.click());
    expect(mocks.initialize).toHaveBeenCalledTimes(2);
    expect(mocks.apply).not.toHaveBeenCalled();
    await reportState({ status: "downloading", progress: 12 });
    expect(container.textContent).toContain("12%");
    await reportState({ status: "ready", bundleId: "bundle-2" });
    await act(async () => {
      finishRetry?.("queued");
      await retry;
    });
    expect(container.querySelector("button")?.textContent).toBe(
      "Reload to apply"
    );
    expect(container.querySelector("button")?.disabled).toBe(false);
  });

  // unmounted shells cannot revive the notice
  it("ignores state from a retired component", async () => {
    const container = await renderPrompt();
    await act(async () => root?.unmount());
    root = undefined;
    await reportState({ status: "ready", bundleId: "bundle-2" });
    expect(container.textContent).toBe("");
  });

  // a manifest failure on retry must not silently dismiss the failed download
  it("keeps retry available when the next update check fails", async () => {
    const container = await renderPrompt();
    await reportState({ status: "failed" });
    mocks.initialize.mockResolvedValue("failed");
    await act(async () => container.querySelector("button")?.click());
    expect(container.textContent).toContain("could not download");
    expect(container.querySelector("button")?.textContent).toBe(
      "Retry download"
    );
    expect(container.querySelector("button")?.disabled).toBe(false);
    expect(mocks.initialize).toHaveBeenCalledTimes(2);
  });

  // keep warnings above resized notices and release space after unmount
  it("resizes and removes the reserved space above the OTA notice", async () => {
    const height = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(136);
    const observe = vi.fn();
    const disconnect = vi.fn();
    let reportResize: (() => void) | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        // expose the native resize callback
        constructor(callback: () => void) {
          reportResize = callback;
        }

        observe = observe;
        disconnect = disconnect;
      }
    );
    const container = await renderPrompt();
    await reportState({ status: "downloading", progress: 42 });
    const warning = container.querySelector<HTMLDivElement>(".alert--warning");
    expect(warning?.style.marginBottom).toContain(
      "136px + var(--toast-stack-gap)"
    );
    expect(observe).toHaveBeenCalledOnce();

    await reportState({ status: "ready", bundleId: "bundle-2" });
    height.mockReturnValue(172);
    act(() => reportResize?.());
    expect(warning?.style.marginBottom).toContain(
      "172px + var(--toast-stack-gap)"
    );

    await reportState({ status: "idle" });
    expect(warning?.style.marginBottom).toBe("");
    expect(disconnect).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Your device is offline");
    expect(container.textContent).not.toContain("Ferry FYI update");
  });
});
