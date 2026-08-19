// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InstallPromptToast } from "../../client/components/InstallPromptToast";
import { FeatureFlagContext } from "../../client/lib/featureFlagContext";

// share one inert listener cleanup
const mocks = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
}));

vi.mock("~/components/Prompt", () => ({
  // expose prompt copy without toast arbitration
  Prompt: ({ children }: React.PropsWithChildren) => <aside>{children}</aside>,
}));
vi.mock("~/lib/appInstall", () => ({
  // keep the generic prompt on desktop
  getBrowserInstallPlatform: () => "web",
  // detach the request listener cleanly
  subscribeInstallPromptRequests: () => mocks.unsubscribe,
}));
vi.mock("~/lib/browser", () => ({
  // return a visitor eligible for the generic promotion
  useLocalStorage: (key: string) =>
    key === "installPromptLoadCount"
      ? ([3, vi.fn()] as const)
      : ([false, vi.fn()] as const),
}));
vi.mock("~/lib/device", () => ({
  // keep the visitor in a browser
  isInstalledApp: () => false,
}));
vi.mock("~/lib/installPrompt", () => ({
  // omit the deferred browser prompt
  hasInstallPrompt: () => false,
  // detach the availability listener cleanly
  subscribeInstallPrompt: () => mocks.unsubscribe,
  triggerInstallPrompt: vi.fn(),
}));

let root: Root | undefined;

// render one automatic rollout state
const renderPrompt = async (
  automaticLeaderboardCheckinsEnabled: boolean
): Promise<HTMLDivElement> => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <FeatureFlagContext.Provider
        value={{
          automaticLeaderboardCheckinsEnabled,
          leaderboardsEnabled: true,
          loading: false,
        }}
      >
        <InstallPromptToast />
      </FeatureFlagContext.Provider>
    );
    await Promise.resolve();
  });
  return container;
};

// enable react effect assertions
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

// release each prompt render
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

// prevent competing install promotions
describe("InstallPromptToast automatic rollout", () => {
  // retain the generic prompt normally
  it("shows the generic promotion when automatic check-ins are off", async () => {
    const container = await renderPrompt(false);

    expect(container.textContent).toContain("Add this website");
  });

  // defer to the automatic check-in banner
  it("hides the generic promotion when automatic check-ins are on", async () => {
    const container = await renderPrompt(true);

    expect(container.textContent).toBe("");
  });
});
