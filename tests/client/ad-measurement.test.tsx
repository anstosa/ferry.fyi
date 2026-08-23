// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ post: vi.fn(), postKeepalive: vi.fn() }));
vi.mock("~/lib/api", () => api);
vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({ isAuthenticated: false, user: undefined }),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));

import { AdSlot } from "../../client/components/AdSlot";
import { measureAdExposure } from "../../client/lib/ads";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
const observers: Array<{
  callback: IntersectionObserverCallback;
  element?: Element;
}> = [];

class ObserverMock {
  callback: IntersectionObserverCallback;
  element?: Element;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }

  disconnect(): void {}
  observe(element: Element): void {
    this.element = element;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(): void {}
  root = null;
  rootMargin = "0px";
  thresholds = [0];
}

const intersect = (selector: string, ratio: number): void => {
  const observer = observers.find((candidate) =>
    candidate.element?.matches(selector)
  );
  if (!observer?.element) {
    throw new Error(`Missing observer for ${selector}`);
  }
  observer.callback(
    [
      {
        intersectionRatio: ratio,
        target: observer.element,
      } as IntersectionObserverEntry,
    ],
    observer as unknown as IntersectionObserver
  );
};

beforeEach(() => {
  vi.useFakeTimers();
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", ObserverMock);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  api.post.mockImplementation((path: string) => {
    if (path === "/ads/exposures") {
      return Promise.resolve({
        creative: {
          advertiserName: "Island Coffee",
          body: "Open early",
          campaignId: "campaign",
          headline: "Coffee nearby",
          placementKey: "schedule--3--7",
          targetUrl: "https://example.com/menu",
        },
        expiresAt: "2026-08-04T18:00:00.000Z",
        token: "adx_example",
      });
    }
    return Promise.resolve({});
  });
  api.postKeepalive.mockResolvedValue({});
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("client ad measurement", () => {
  it("retries a keepalive claim once and then succeeds", async () => {
    api.postKeepalive
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({});

    const claim = measureAdExposure("adx_example", "served");
    await vi.advanceTimersByTimeAsync(150);
    await claim;

    expect(api.postKeepalive).toHaveBeenCalledTimes(2);
  });

  it("requires one continuous second and sends each claim once", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <AdSlot
            arrivalTerminalId="7"
            contextLabel="Schedule"
            departureTerminalId="3"
            slot="schedule"
          />
        </MemoryRouter>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.postKeepalive).toHaveBeenCalledWith(
      "/ads/measure",
      { event: "served", token: "adx_example" },
      undefined
    );

    act(() => intersect("[data-ad-campaign]", 0.5));
    await act(async () => vi.advanceTimersByTime(999));
    expect(api.postKeepalive).not.toHaveBeenCalledWith(
      "/ads/measure",
      { event: "viewable", token: "adx_example" },
      undefined
    );
    await act(async () => vi.advanceTimersByTime(1));
    expect(api.postKeepalive).toHaveBeenCalledWith(
      "/ads/measure",
      { event: "viewable", token: "adx_example" },
      undefined
    );

    act(() => {
      intersect("[data-ad-campaign]", 0);
      intersect("[data-ad-campaign]", 1);
    });
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(
      api.postKeepalive.mock.calls.filter(
        ([path, value]) => path === "/ads/measure" && value.event === "viewable"
      )
    ).toHaveLength(1);

    act(() => intersect("[data-ad-opportunity-anchor]", 1));
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(api.postKeepalive).toHaveBeenCalledWith(
      "/ads/measure",
      { event: "opportunity", token: "adx_example" },
      undefined
    );
  });
});
