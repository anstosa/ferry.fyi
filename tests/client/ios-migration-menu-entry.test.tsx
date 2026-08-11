// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const device = vi.hoisted(() => ({
  isNativeMobile: true,
  platform: "ios",
}));

vi.mock("@auth0/auth0-react", () => ({
  // unauthenticated fixture
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
  Share: { canShare: vi.fn(() => Promise.resolve({ value: false })) },
}));
vi.mock("~/lib/appInstall", () => ({
  getBrowserInstallPlatform: vi.fn(() => null),
  requestInstallPrompt: vi.fn(),
}));
vi.mock("~/lib/auth", () => ({
  getConfiguredAuth0RedirectUri: vi.fn(() => "fyi.ferry://callback"),
  loginWithAppFlow: vi.fn(),
}));
vi.mock("~/lib/device", () => ({
  isInstalledApp: vi.fn(() => true),
  useDevice: () => device,
}));
vi.mock("~/lib/featureFlags", () => ({
  useFeatureFlags: vi.fn(() => ({ leaderboardsEnabled: false })),
}));

import { Menu } from "../../client/views/Menu";

// menu fixture
const renderMenu = (): string =>
  renderToStaticMarkup(
    <MemoryRouter>
      <Menu hasTopBanner={false} isOpen onClose={vi.fn()} onOpen={vi.fn()} />
    </MemoryRouter>
  );

describe("iOS migration menu entry", () => {
  // platform reset
  beforeEach(() => {
    device.platform = "ios";
  });

  // ios navigation contract
  it("offers one login page entry in the iOS app", () => {
    const menu = renderMenu();

    expect(menu).toContain('href="/login"');
    expect(menu.match(/Log In/g)).toHaveLength(1);
    expect(menu).not.toContain("Move Google account");
  });

  // android navigation contract
  it("keeps Android on the direct login action", () => {
    device.platform = "android";
    const menu = renderMenu();

    expect(menu).not.toContain('href="/login"');
    expect(menu).not.toContain("Move Google account");
  });
});
