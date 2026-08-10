// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

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
  it("offers the generic migration path in the iOS app", () => {
    expect(renderMenu()).toContain('href="/ios"');
    expect(renderMenu()).toContain("Move Google account");
  });

  it("does not show the migration entry on Android", () => {
    device.platform = "android";
    expect(renderMenu()).not.toContain("Move Google account");
    device.platform = "ios";
  });
});
