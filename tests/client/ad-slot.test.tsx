// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getAccessTokenSilently: vi.fn().mockResolvedValue("test-access-token"),
  isAuthenticated: false,
  isLoading: false,
  user: { email: "rider@example.com" },
}));
const api = vi.hoisted(() => ({ post: vi.fn(), postKeepalive: vi.fn() }));
const navigation = vi.hoisted(() => ({ navigate: vi.fn() }));
const seed = vi.hoisted(
  (): { ad?: import("../../shared/contracts/ssr").PublicSsrAd } => ({})
);
const user = vi.hoisted(() => ({
  isUserLoading: false,
  user: {
    supporter: {
      active: false,
      activeUntil: null,
      lifecycleState: "none",
      resolved: true,
      revision: "v1:0:1",
    },
  },
}));

vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth }));
vi.mock("~/lib/api", () => api);
vi.mock("~/lib/user", () => ({ useUser: () => [user] }));
vi.mock("~/lib/ssrSeed", () => ({
  usePublicSsrSource: (key: string) => (key === "ad" ? seed.ad : undefined),
}));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigation.navigate,
}));

import { AdSlot } from "../../client/components/AdSlot";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

const renderSlot = async (className?: string): Promise<HTMLDivElement> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <AdSlot
          arrivalTerminalId="14"
          className={className}
          contextLabel="Schedule · Clinton to Mukilteo"
          departureTerminalId="5"
          slot="schedule"
        />
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
  auth.isAuthenticated = false;
  auth.user = { email: "rider@example.com" };
  seed.ad = undefined;
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("AdSlot", () => {
  it("renders the server-seeded creative before the exposure request settles", async () => {
    seed.ad = {
      creative: {
        advertiserName: "Island Coffee",
        body: "Coffee near the dock.",
        campaignId: "5ed338e9-acbb-4cca-9380-1a923bfca5c8",
        headline: "Fuel up before sailing",
        placementKey: "schedule--5--14",
        targetUrl: "https://example.com/menu",
      },
      placementKey: "schedule--5--14",
    };
    api.post.mockReturnValue(new Promise(() => undefined));

    const container = await renderSlot();

    expect(container.textContent).toContain("Island Coffee");
    expect(container.textContent).toContain("Fuel up before sailing");
    expect(api.post).toHaveBeenCalledWith(
      "/ads/exposures",
      { placementKey: "schedule--5--14" },
      undefined
    );
  });

  it("removes a stale server-seeded creative when live serving is disabled", async () => {
    seed.ad = {
      creative: {
        advertiserName: "Island Coffee",
        body: "Coffee near the dock.",
        campaignId: "5ed338e9-acbb-4cca-9380-1a923bfca5c8",
        headline: "Fuel up before sailing",
        placementKey: "schedule--5--14",
        targetUrl: "https://example.com/menu",
      },
      placementKey: "schedule--5--14",
    };
    api.post.mockResolvedValue({
      creative: null,
      expiresAt: "2026-08-04T18:00:00.000Z",
      token: "adx_test",
    });

    const container = await renderSlot();

    await vi.waitFor(() =>
      expect(container.textContent).not.toContain("Island Coffee")
    );
    expect(container.querySelector("[data-ad-placeholder]")).toBeNull();
  });

  it("hides an unconfigured placement from riders", async () => {
    api.post.mockResolvedValue({
      creative: null,
      expiresAt: "2026-08-04T18:00:00.000Z",
      token: "adx_test",
    });

    const container = await renderSlot();

    expect(
      container.querySelector("[data-ad-opportunity-anchor]")
    ).not.toBeNull();
    expect(container.querySelector("[data-ad-placeholder]")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("does not retain placement spacing when no ad is visible", async () => {
    api.post.mockResolvedValue({
      creative: null,
      expiresAt: "2026-08-04T18:00:00.000Z",
      token: "adx_test",
    });

    const container = await renderSlot("p-2");

    expect(container.querySelector("[data-ad-slot]")?.className).toBe(
      "relative h-0"
    );
  });

  it("lets the global switch suppress a configured placement", async () => {
    api.post.mockResolvedValue({
      creative: null,
      expiresAt: "2026-08-04T18:00:00.000Z",
      token: "adx_test",
    });

    const container = await renderSlot();

    expect(
      container.querySelector("[data-ad-opportunity-anchor]")
    ).not.toBeNull();
    expect(container.textContent).toBe("");
  });

  it("shows an unconfigured placement placeholder only to the owner", async () => {
    auth.isAuthenticated = true;
    auth.user = { email: "anstosa@gmail.com" };
    api.post.mockResolvedValue({
      creative: null,
      expiresAt: "2026-08-04T18:00:00.000Z",
      token: "adx_test",
    });

    const container = await renderSlot();

    const placeholder = container.querySelector("[data-ad-placeholder]");
    expect(placeholder).not.toBeNull();
    expect(container.textContent).toContain("Clinton to Mukilteo");
    expect(placeholder?.className).toContain("border-dotted");
    expect(placeholder?.className).toContain("bg-transparent");
    expect(placeholder?.className).toContain("text-left");
    expect(placeholder?.className).not.toContain("bg-black/5");
    expect(placeholder?.nextElementSibling?.textContent).toBe("Advertisement");
  });

  it("opens the matching placement configuration when an owner taps a placeholder", async () => {
    auth.isAuthenticated = true;
    auth.user = { email: "anstosa@gmail.com" };
    api.post.mockResolvedValue({
      creative: null,
      expiresAt: "2026-08-04T18:00:00.000Z",
      token: "adx_test",
    });

    const container = await renderSlot();

    act(() => {
      (container.querySelector("[data-ad-placeholder]") as HTMLElement).click();
    });
    expect(navigation.navigate).toHaveBeenCalledWith(
      "/admin?placement=schedule--5--14&tab=ads#admin-ad-placement"
    );
  });

  // verify contextual disclosure and reporting
  it("matches route advertisements by direction", async () => {
    api.post.mockResolvedValue({
      creative: {
        advertiserName: "Island Coffee",
        body: "Coffee near the dock.",
        campaignId: "5ed338e9-acbb-4cca-9380-1a923bfca5c8",
        headline: "Fuel up before sailing",
        placementKey: "schedule--5--14",
        targetUrl: "https://example.com/menu",
      },
      expiresAt: "2026-08-04T18:00:00.000Z",
      token: "adx_test",
    });

    const container = await renderSlot();

    expect(container.textContent).toContain("Island Coffee");
    expect(container.textContent).toContain("Fuel up before sailing");
    const clickTarget = container.querySelector("[data-ad-click-target]");
    expect(clickTarget?.tagName).toBe("A");
    expect(clickTarget?.getAttribute("href")).toBe("https://example.com/menu");
    expect(clickTarget?.getAttribute("target")).toBe("_blank");
    expect(clickTarget?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(clickTarget?.textContent).not.toContain("View menu");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector(".button-primary")).toBeNull();
    const disclosure = clickTarget?.nextElementSibling;
    expect(disclosure?.textContent).toBe(
      "Advertisement · Why this ad? · Report ad"
    );
    expect(disclosure?.tagName).toBe("P");
    expect(
      container.querySelector('a[href="/privacy#advertising"]')?.textContent
    ).toBe("Why this ad?");
    const reportLink = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="Report advertisement from Island Coffee"]'
    );
    const reportUrl = new URL(reportLink?.href ?? "");
    expect(reportUrl.protocol).toBe("mailto:");
    expect(reportUrl.pathname).toBe("dev@ferry.fyi");
    expect(reportUrl.searchParams.get("body")).toContain(
      "Campaign: 5ed338e9-acbb-4cca-9380-1a923bfca5c8"
    );
    expect(reportUrl.searchParams.get("body")).toContain(
      "Placement: schedule--5--14"
    );

    clickTarget?.addEventListener("click", (event) => event.preventDefault());
    act(() => {
      clickTarget?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    expect(api.postKeepalive).toHaveBeenCalledWith(
      "/ads/click",
      {
        campaignId: "5ed338e9-acbb-4cca-9380-1a923bfca5c8",
        token: "adx_test",
      },
      undefined
    );
  });

  it("opens the matching placement configuration when an owner long presses an active ad", async () => {
    vi.useFakeTimers();
    auth.isAuthenticated = true;
    auth.user = { email: "anstosa@gmail.com" };
    api.post.mockResolvedValue({
      creative: {
        advertiserName: "Island Coffee",
        body: "Coffee near the dock.",
        campaignId: "5ed338e9-acbb-4cca-9380-1a923bfca5c8",
        headline: "Fuel up before sailing",
        placementKey: "schedule--5--14",
        targetUrl: "https://example.com/menu",
      },
      expiresAt: "2026-08-04T18:00:00.000Z",
      token: "adx_test",
    });
    const container = await renderSlot();
    const ad = container.querySelector("[data-ad-campaign]") as HTMLElement;

    act(() => {
      ad.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 10,
          clientY: 10,
        })
      );
      vi.advanceTimersByTime(600);
    });

    expect(navigation.navigate).toHaveBeenCalledWith(
      "/admin?placement=schedule--5--14&tab=ads#admin-ad-placement"
    );
  });
});
