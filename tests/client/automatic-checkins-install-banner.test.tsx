// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutomaticCheckinsInstallBanner } from "../../client/components/AutomaticCheckinsInstallBanner";
import { FeatureFlagContext } from "../../client/lib/featureFlagContext";

const mocks = vi.hoisted(() => ({
  native: false,
}));

vi.mock("~/lib/device", () => ({
  // switch the native boundary per test
  isNativeMobileApp: () => mocks.native,
}));
vi.mock("framer-motion", () => ({
  motion: { div: "div" },
}));

let root: Root | undefined;

// render one flag state and settle toast registration
const renderBanner = async (
  automaticLeaderboardCheckinsEnabled: boolean
): Promise<HTMLDivElement> => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <FeatureFlagContext.Provider
          value={{
            automaticLeaderboardCheckinsEnabled,
            leaderboardsEnabled: true,
            loading: false,
          }}
        >
          <AutomaticCheckinsInstallBanner />
        </FeatureFlagContext.Provider>
      </MemoryRouter>
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
};

// reset one web visitor
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.native = false;
  window.localStorage.clear();
});

// release each rendered banner
afterEach(async () => {
  await act(async () => {
    root?.unmount();
    await Promise.resolve();
  });
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// cover web promotion visibility and dismissal
describe("AutomaticCheckinsInstallBanner", () => {
  // show the flagged promotion
  it("advertises automatic background check-ins with the install route", async () => {
    const container = await renderBanner(true);

    expect(container.textContent).toContain("Automatic background check-ins");
    expect(container.textContent).toContain(
      "available in the Ferry FYI mobile app"
    );
    expect(container.querySelector('a[href="/install"]')?.textContent).toBe(
      "Install the app"
    );
  });

  // honor the rollout gate
  it("stays hidden when the automatic feature flag is off", async () => {
    const container = await renderBanner(false);

    expect(container.textContent).toBe("");
  });

  // avoid native self-promotion
  it("stays hidden inside the native app", async () => {
    mocks.native = true;
    const container = await renderBanner(true);

    expect(container.textContent).toBe("");
  });

  // remember the close action
  it("persists dismissal from the close icon", async () => {
    const container = await renderBanner(true);
    const close = container.querySelector<SVGElement>(".alert__close");

    expect(close).not.toBeNull();
    await act(async () =>
      close?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );

    expect(
      window.localStorage.getItem("hideAutomaticCheckinsInstallBanner")
    ).toBe("true");
    expect(container.textContent).toBe("");
  });
});
