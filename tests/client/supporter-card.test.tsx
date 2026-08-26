// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth0 = vi.hoisted(() => ({
  loginWithPopup: vi.fn(),
  loginWithRedirect: vi.fn(),
}));
const browser = vi.hoisted(() => ({ open: vi.fn() }));
const platform = vi.hoisted(() => ({ value: "web" }));
const supporter = vi.hoisted(() => ({
  error: null as string | null,
  isBusy: false,
  isLoading: false,
  manage: vi.fn(),
  products: [],
  purchase: vi.fn(),
  refresh: vi.fn(),
  restore: vi.fn(),
  setAdsEnabled: vi.fn(),
  status: null,
}));
const user = vi.hoisted(
  (): { isAuthenticated: boolean; user?: { user_id: string } } => ({
    isAuthenticated: true,
    user: { user_id: "auth0|rider-a" },
  })
);

vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth0 }));
vi.mock("@capacitor/browser", () => ({ Browser: browser }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => platform.value },
}));
vi.mock("~/lib/supporterContext", () => ({
  useSupporter: () => supporter,
}));
vi.mock("~/lib/user", () => ({ useUser: () => [user] }));

import { SupporterCard } from "~/components/SupporterCard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

// render the supporter purchase surface
const renderCard = async (embedded = false): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <SupporterCard embedded={embedded} />
      </MemoryRouter>
    );
    await Promise.resolve();
  });
};

describe("SupporterCard", () => {
  beforeEach(() => {
    auth0.loginWithPopup.mockReset().mockResolvedValue(undefined);
    auth0.loginWithRedirect.mockReset().mockResolvedValue(undefined);
    browser.open.mockReset().mockResolvedValue(undefined);
    platform.value = "web";
    supporter.error = null;
    supporter.refresh.mockReset().mockResolvedValue(undefined);
    supporter.setAdsEnabled.mockReset().mockResolvedValue(undefined);
    supporter.purchase.mockReset().mockResolvedValue({ outcome: "cancelled" });
    supporter.products = [];
    supporter.status = null;
    user.isAuthenticated = true;
    user.user = { user_id: "auth0|rider-a" };
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    container?.remove();
    container = undefined;
  });

  // defer provider identity until the purchase surface opens
  it("loads supporter state once per authenticated account", async () => {
    await renderCard();
    expect(supporter.refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      root?.render(
        <MemoryRouter>
          <SupporterCard />
        </MemoryRouter>
      );
      await Promise.resolve();
    });
    expect(supporter.refresh).toHaveBeenCalledTimes(1);

    user.user = { user_id: "auth0|rider-b" };
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <SupporterCard />
        </MemoryRouter>
      );
      await Promise.resolve();
    });
    expect(supporter.refresh).toHaveBeenCalledTimes(2);
  });

  // preserve signed-out privacy boundary
  it("does not allocate billing identity for signed-out visitors", async () => {
    user.isAuthenticated = false;
    user.user = undefined;

    await renderCard();

    expect(supporter.refresh).not.toHaveBeenCalled();
  });

  // start universal auth0 login outside ios
  it("starts the normal auth0 flow for signed-out web visitors", async () => {
    user.isAuthenticated = false;
    user.user = undefined;

    await renderCard();

    const signInButton = Array.from(
      container?.querySelectorAll("button") ?? []
    ).find((button) => button.textContent?.includes("Sign in to subscribe"));
    expect(signInButton).toBeDefined();
    expect(container?.querySelector('a[href="/login"]')).toBeNull();

    await act(async () => {
      signInButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(auth0.loginWithRedirect).toHaveBeenCalledWith({
      appState: { redirectPath: "/supporter" },
      authorizationParams: {
        redirect_uri: process.env.AUTH0_CLIENT_REDIRECT,
      },
    });
  });

  // open android auth in the system browser
  it("starts the normal native auth0 flow for signed-out android visitors", async () => {
    platform.value = "android";
    user.isAuthenticated = false;
    user.user = undefined;

    await renderCard();

    const signInButton = Array.from(
      container?.querySelectorAll("button") ?? []
    ).find((button) => button.textContent?.includes("Sign in to subscribe"));
    await act(async () => {
      signInButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    const loginOptions = auth0.loginWithRedirect.mock.calls[0]?.[0];
    expect(loginOptions).toMatchObject({
      appState: { redirectPath: "/supporter" },
      authorizationParams: {
        redirect_uri: `fyi.ferry://${process.env.AUTH0_DOMAIN}/capacitor/fyi.ferry/callback`,
      },
    });
    await loginOptions?.openUrl?.("https://auth.ferry.fyi/authorize");
    expect(browser.open).toHaveBeenCalledWith({
      url: "https://auth.ferry.fyi/authorize",
    });
  });

  // preserve ios password login
  it("links signed-out ios visitors to the dedicated login page", async () => {
    platform.value = "ios";
    user.isAuthenticated = false;
    user.user = undefined;

    await renderCard();

    const signInLink = container?.querySelector('a[href="/login"]');
    expect(signInLink?.textContent).toContain("Sign in to subscribe");
    expect(auth0.loginWithRedirect).not.toHaveBeenCalled();
  });

  // keep embedded benefits plain and vertical
  it("renders embedded benefits as a vertical checkmark list", async () => {
    user.isAuthenticated = false;
    user.user = undefined;

    await renderCard(true);

    const card = container?.querySelector("section");
    const benefitList = card?.querySelector(":scope > ul");
    const firstBenefit = benefitList?.querySelector("li");
    expect(card?.className).toBe("mt-7");
    expect(benefitList?.className).toContain("flex-col");
    expect(benefitList?.className).not.toContain("grid");
    expect(firstBenefit?.className).not.toContain("rounded");
    expect(firstBenefit?.className).not.toContain("bg-");
    expect(firstBenefit?.querySelector("svg")).not.toBeNull();
    expect(container?.textContent).not.toContain(
      "Support an independent ferry app"
    );
    expect(container?.textContent).toContain(
      "No Ferry FYI advertisements while signed in"
    );
    expect(container?.textContent).not.toContain("Automatic check-ins");
    expect(container?.textContent).toContain("Sign in to subscribe");
  });

  // match the account card benefit treatment
  it("renders account benefits as the same vertical checkmark list", async () => {
    await renderCard();

    const benefitList = container?.querySelector("section > ul");
    const firstBenefit = benefitList?.querySelector("li");
    expect(benefitList?.className).toContain("flex-col");
    expect(benefitList?.className).not.toContain("list-disc");
    expect(firstBenefit?.querySelector("svg")).not.toBeNull();
  });

  // avoid inventing unavailable prices
  it("omits price claims when checkout products are unavailable", async () => {
    supporter.status = {
      active: false,
      activeUntil: null,
      sources: [],
      supporterBadgeVisible: false,
    };

    await renderCard();

    expect(container?.textContent).toContain(
      "Subscription checkout is not available"
    );
    expect(container?.textContent).toContain(
      "Ferry FYI Supporter renews automatically until canceled"
    );
    expect(container?.textContent).not.toContain("the displayed monthly price");
    expect(container?.textContent).not.toContain("the displayed yearly price");
  });

  // prefer the actionable provider failure
  it("does not cover a product loading error with generic availability copy", async () => {
    supporter.error = "The Supporter offering is incomplete";
    supporter.status = {
      active: false,
      activeUntil: null,
      sources: [],
      supporterBadgeVisible: false,
    };

    await renderCard();

    expect(container?.textContent).toContain(
      "The Supporter offering is incomplete"
    );
    expect(container?.textContent).not.toContain(
      "Subscription checkout is not available"
    );
  });

  // keep badge consent in leaderboard settings only
  it("does not render a duplicate badge setting for active supporters", async () => {
    supporter.status = {
      active: true,
      activeUntil: "2026-09-24T18:07:12.118Z",
      adsEnabled: false,
      sources: [
        {
          activeUntil: "2026-09-24T18:07:12.118Z",
          lifecycleState: "active",
          planInterval: "month",
          productIdentifier: "supporter_monthly",
          store: "rc_billing",
          willRenew: true,
        },
      ],
      supporterBadgeVisible: true,
    };

    await renderCard();

    expect(container?.textContent).toContain("Active Supporter");
    expect(container?.textContent).toContain("Manage subscription");
    expect(container?.textContent).toContain(
      "Ferry FYI website · renews Sep 24, 2026"
    );
    expect(container?.textContent).not.toContain("Show my Supporter badge");
    expect(container?.querySelector('input[type="checkbox"]')).toBeNull();
  });

  // let active supporters voluntarily restore ads from Account
  it("toggles advertisements only from the account supporter block", async () => {
    supporter.status = {
      active: true,
      activeUntil: "2026-09-24T18:07:12.118Z",
      adsEnabled: false,
      sources: [],
      supporterBadgeVisible: true,
    };

    await renderCard();

    const toggle = container?.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Show Ferry FYI advertisements"]'
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(container?.textContent).toContain(
      "Your ad-free experience is active"
    );
    expect(container?.textContent).toContain("Support local advertisers too");

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });

    expect(supporter.setAdsEnabled).toHaveBeenCalledWith(true);

    act(() => root?.unmount());
    root = undefined;
    container?.remove();
    container = undefined;
    await renderCard(true);
    expect(
      container?.querySelector(
        '[role="switch"][aria-label="Show Ferry FYI advertisements"]'
      )
    ).toBeNull();
  });

  // separate plan choice from checkout
  it("selects a plan before continuing to checkout", async () => {
    supporter.status = {
      active: false,
      activeUntil: null,
      sources: [],
      supporterBadgeVisible: false,
    };
    supporter.products = [
      {
        identifier: "supporter_monthly",
        interval: "month",
        price: "$2.49",
      },
      {
        identifier: "supporter_yearly",
        interval: "year",
        price: "$19.99",
      },
    ];

    await renderCard();

    const planButtons = container?.querySelectorAll("button[aria-pressed]");
    const monthlyButton = planButtons?.item(0);
    const yearlyButton = planButtons?.item(1);
    const continueButton = container?.querySelector("button.button-primary");
    expect(container?.textContent).toContain("33% OFF");
    expect(container?.textContent).not.toContain("Best value");
    expect(container?.textContent).not.toContain("About 33% less");
    expect(container?.textContent).toContain(
      "selected storefront price—$2.49 each month or $19.99 each year—until canceled"
    );
    expect(container?.textContent).toContain(
      "Payment is charged by Ferry FYI's billing provider when you confirm"
    );
    expect(container?.textContent).toContain(
      "Manage or cancel your subscription through the Ferry FYI billing portal"
    );
    expect(container?.textContent).not.toContain("Restore Purchases");
    expect(container?.textContent).not.toContain("Applicable tax may be added");
    expect(container?.textContent).not.toContain("On the US website");
    expect(monthlyButton?.getAttribute("aria-pressed")).toBe("false");
    expect(yearlyButton?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      monthlyButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(supporter.purchase).not.toHaveBeenCalled();
    expect(monthlyButton?.getAttribute("aria-pressed")).toBe("true");
    expect(yearlyButton?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      continueButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(supporter.purchase).toHaveBeenCalledOnce();
    expect(supporter.purchase).toHaveBeenCalledWith("month");
  });

  // disclose apple subscription terms
  it("uses app store purchase language on ios", async () => {
    platform.value = "ios";
    supporter.status = {
      active: false,
      activeUntil: null,
      sources: [],
      supporterBadgeVisible: false,
    };
    supporter.products = [
      {
        identifier: "supporter_monthly",
        interval: "month",
        price: "$2.49",
      },
      {
        identifier: "supporter_yearly",
        interval: "year",
        price: "$19.99",
      },
    ];

    await renderCard();

    expect(container?.textContent).toContain(
      "Payment is charged to your Apple Account when you confirm"
    );
    expect(container?.textContent).toContain(
      "Manage or cancel your subscription in App Store subscription settings"
    );
    expect(container?.textContent).toContain(
      "existing subscribers can use Restore Purchases"
    );
    expect(container?.textContent).toContain(
      "Sign in to your Ferry FYI account to use Supporter benefits"
    );
  });

  // disclose google subscription terms
  it("uses google play purchase language on android", async () => {
    platform.value = "android";
    supporter.status = {
      active: false,
      activeUntil: null,
      sources: [],
      supporterBadgeVisible: false,
    };
    supporter.products = [
      {
        identifier: "supporter_monthly",
        interval: "month",
        price: "$2.49",
      },
      {
        identifier: "supporter_yearly",
        interval: "year",
        price: "$19.99",
      },
    ];

    await renderCard();

    expect(container?.textContent).toContain(
      "Payment is charged to your Google Play account when you confirm"
    );
    expect(container?.textContent).toContain(
      "Manage or cancel your subscription in Google Play subscription settings"
    );
    expect(container?.textContent).toContain(
      "existing subscribers can use Restore Purchases"
    );
  });
});
