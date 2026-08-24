// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supporter = vi.hoisted(() => ({
  error: null,
  isBusy: false,
  isLoading: false,
  manage: vi.fn(),
  products: [],
  purchase: vi.fn(),
  refresh: vi.fn(),
  restore: vi.fn(),
  status: null,
}));
const user = vi.hoisted(() => ({ isAuthenticated: false }));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "web" },
}));
vi.mock("~/lib/supporterContext", () => ({
  useSupporter: () => supporter,
}));
vi.mock("~/lib/user", () => ({ useUser: () => [user] }));
vi.mock("~/components/SeoHelmet", () => ({
  // seo fixture
  SeoHelmet: () => null,
}));

import { Supporter } from "../../client/views/Supporter";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

beforeEach(() => {
  supporter.error = null;
  supporter.isBusy = false;
  supporter.isLoading = false;
  supporter.products = [];
  supporter.purchase.mockReset().mockResolvedValue(null);
  supporter.refresh.mockReset().mockResolvedValue(undefined);
  supporter.status = null;
  user.isAuthenticated = false;
});

// render the full supporter route
const renderSupporter = async (): Promise<HTMLElement> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <Supporter />
      </MemoryRouter>
    );
    await Promise.resolve();
  });
  return container;
};

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("Supporter page", () => {
  // mirror the full-screen migration presentation
  it("uses the branded full-screen shell around checkout", async () => {
    const container = await renderSupporter();
    const page = container.querySelector("main");

    expect(page?.className).toContain("min-h-[100dvh]");
    expect(page?.className).toContain("bg-ferry-gradient");
    expect(container.textContent).toContain("Ferry FYI");
    expect(container.textContent).toContain("Support an independent ferry app");
    expect(container.textContent).toContain(
      "Enjoy Ferry FYI without advertisements"
    );
    expect(container.textContent).toContain("Sign in to subscribe");
    expect(container.textContent).toContain("Back to ferry schedules");
  });

  // replace checkout with a successful verification splash
  it("shows pending purchase verification as a success loader", async () => {
    vi.useFakeTimers();
    user.isAuthenticated = true;
    supporter.status = {
      active: false,
      activeUntil: null,
      sources: [],
      supporterBadgeVisible: false,
    };
    supporter.products = [
      { interval: "month", price: "$2.49" },
      { interval: "year", price: "$19.99" },
    ];
    supporter.purchase.mockResolvedValue({
      outcome: "verification_pending",
      status: supporter.status,
    });
    const container = await renderSupporter();
    const continueButton = container.querySelector("button.button-primary");

    await act(async () => {
      continueButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const splash = container.querySelector('[role="status"]');
    expect(supporter.purchase).toHaveBeenCalledWith("year");
    expect(container.textContent).toContain("Purchase received");
    expect(container.textContent).toContain(
      "Ferry FYI is verifying your access."
    );
    expect(container.textContent).toContain("Payment confirmed");
    expect(container.textContent).toContain("Verifying Supporter access");
    expect(splash?.className).not.toContain("red");
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(supporter.refresh).toHaveBeenCalledOnce();
  });

  // replace the loader after the refreshed projection becomes active
  it("finishes a pending purchase after supporter access activates", async () => {
    user.isAuthenticated = true;
    supporter.status = {
      active: false,
      activeUntil: null,
      sources: [],
      supporterBadgeVisible: false,
    };
    supporter.products = [
      { interval: "month", price: "$2.49" },
      { interval: "year", price: "$19.99" },
    ];
    supporter.purchase.mockResolvedValue({
      outcome: "verification_pending",
      status: supporter.status,
    });
    const container = await renderSupporter();
    const continueButton = container.querySelector("button.button-primary");

    await act(async () => {
      continueButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    supporter.status = {
      ...supporter.status,
      active: true,
      activeUntil: "2026-09-24T18:07:12.118Z",
      supporterBadgeVisible: true,
    };
    await act(async () => {
      // preserve route state while exposing the refreshed context value
      root?.render(
        <MemoryRouter>
          <Supporter />
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("You’re all set");
    expect(container.textContent).toContain("Supporter active");
    expect(container.textContent).not.toContain(
      "Verifying Supporter access…"
    );
  });
});
