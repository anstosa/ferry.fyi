// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canShare: vi.fn(() => Promise.resolve({ value: true })),
  share: vi.fn(() => Promise.resolve()),
  trackUsefulEvent: vi.fn(),
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    getAccessTokenSilently: vi.fn(),
    isAuthenticated: false,
    loginWithPopup: vi.fn(),
    loginWithRedirect: vi.fn(),
    user: undefined,
  }),
}));
vi.mock("@capacitor/browser", () => ({ Browser: { open: vi.fn() } }));
vi.mock("@capacitor/share", () => ({
  Share: { canShare: mocks.canShare, share: mocks.share },
}));
vi.mock("framer-motion", async () => {
  const { createElement } = await import("react");
  return {
    AnimatePresence: ({ children }: React.PropsWithChildren) => children,
    motion: {
      div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
        createElement("div", props, children),
      nav: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) =>
        createElement("nav", props, children),
    },
  };
});
vi.mock("~/lib/analytics", () => ({
  trackUsefulEvent: mocks.trackUsefulEvent,
}));
vi.mock("~/lib/appInstall", () => ({
  getBrowserInstallPlatform: () => "web",
  requestInstallPrompt: vi.fn(),
}));
vi.mock("~/lib/auth", () => ({
  getConfiguredAuth0RedirectUri: () => "http://localhost/callback",
  loginWithAppFlow: vi.fn(),
}));
vi.mock("~/lib/cameraDetectionDebugger", () => ({
  openCameraDetectionDebugger: vi.fn(),
}));
vi.mock("~/lib/device", () => ({
  isInstalledApp: () => true,
  useDevice: () => ({ isNativeMobile: false }),
}));
vi.mock("~/lib/featureFlags", () => ({
  useFeatureFlags: () => ({ leaderboardsEnabled: false }),
}));

import type { ShareSurface } from "../../client/lib/analytics";
import { Menu } from "../../client/views/Menu";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

beforeEach(() => {
  mocks.canShare.mockResolvedValue({ value: true });
  mocks.share.mockResolvedValue(undefined);
});

// restore the mounted menu and diagnostic spies
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// render one classified menu share
const renderShareMenu = async (
  shareSurface?: ShareSurface
): Promise<HTMLDivElement> => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <Menu
          hasTopBanner={false}
          isOpen
          onClose={vi.fn()}
          onOpen={vi.fn()}
          share={{
            shareButtonText: "Share private sentinel",
            sharedText: "Private share sentinel",
            shareSurface,
          }}
        />
      </MemoryRouter>
    );
    await Promise.resolve();
  });
  return container;
};

// click the visible share control
const clickShare = async (container: HTMLElement): Promise<void> => {
  const control = container.querySelector<HTMLElement>(
    '[aria-label="Share private sentinel"]'
  );
  // required share control
  if (!control) {
    throw new Error("Menu share control did not render");
  }
  await act(async () => {
    control.click();
    await Promise.resolve();
  });
};

describe("classified menu sharing", () => {
  // successful classified shares
  it.each(["schedule", "cameras", "bulletins", "terminal", "map"] as const)(
    "qualifies a resolved %s share with fixed metadata only",
    async (surface) => {
      const container = await renderShareMenu(surface);

      await clickShare(container);

      expect(mocks.trackUsefulEvent).toHaveBeenCalledOnce();
      expect(mocks.trackUsefulEvent).toHaveBeenCalledWith("share_completed", {
        method: "share_sheet",
        surface,
      });
      expect(JSON.stringify(mocks.trackUsefulEvent.mock.calls)).not.toContain(
        "Private"
      );
    }
  );

  // failed shares stay silent
  it("stays silent for canceled or failed shares and qualifies a later success", async () => {
    mocks.share
      .mockRejectedValueOnce(new DOMException("canceled", "AbortError"))
      .mockRejectedValueOnce(new Error("native failure"))
      .mockResolvedValueOnce(undefined);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const container = await renderShareMenu("terminal");

    await clickShare(container);
    await clickShare(container);
    expect(mocks.trackUsefulEvent).not.toHaveBeenCalled();

    await clickShare(container);
    expect(mocks.trackUsefulEvent).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledTimes(2);
  });

  // share capability failures stay contained
  it("contains share-capability failures without rendering a share control", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mocks.canShare.mockRejectedValue(new Error("UV_PRIVATE_PLUGIN_FAILURE"));

    const container = await renderShareMenu("map");

    expect(
      container.querySelector('[aria-label="Share private sentinel"]')
    ).toBe(null);
    expect(mocks.trackUsefulEvent).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      "Share availability could not be checked"
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("UV_PRIVATE");
  });

  // unsupported share capability stays silent
  it("omits the share control when native sharing is unsupported", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mocks.canShare.mockResolvedValue({ value: false });

    const container = await renderShareMenu("terminal");

    expect(
      container.querySelector('[aria-label="Share private sentinel"]')
    ).toBe(null);
    expect(mocks.trackUsefulEvent).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });

  // unclassified payloads stay unmeasured
  it("does not classify an unowned generic share payload", async () => {
    const container = await renderShareMenu();

    await clickShare(container);

    expect(mocks.share).toHaveBeenCalledOnce();
    expect(mocks.trackUsefulEvent).not.toHaveBeenCalled();
  });
});
