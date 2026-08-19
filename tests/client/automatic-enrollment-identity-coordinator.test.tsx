// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// expose one mutable auth fixture
const auth = vi.hoisted(() => ({
  getAccessTokenSilently: vi.fn(async () => "access-token"),
  isAuthenticated: true,
  isLoading: false,
  user: { sub: "auth0|one" } as { sub: string } | undefined,
}));
// expose one native ownership fixture
const automatic = vi.hoisted(() => ({
  checkAutomaticEnrollmentCleanup: vi.fn(async () => ({
    matches: false,
    pending: false,
    schemaVersion: 1,
    valid: true,
  })),
  checkAutomaticEnrollmentIdentity: vi.fn(async () => ({
    bound: true,
    matches: true,
    schemaVersion: 1,
  })),
  disableAutomaticLeaderboardAccount: vi.fn(async () => undefined),
  disableAutomaticLeaderboardCheckins: vi.fn(async () => undefined),
  getAutomaticEnrollmentCapability: vi.fn(async () => ({
    capabilityVersion: 1,
    enabled: true,
    manualFallbackAvailable: true,
    platform: "ios",
    schemaVersion: 1,
    supported: true,
  })),
  getAutomaticLeaderboardPlugin: vi.fn(async () => ({ native: true })),
  invalidateAutomaticEnrollmentOperations: vi.fn(),
}));
// expose one native device fixture
const device = vi.hoisted(() => ({ isNativeMobileApp: vi.fn(() => true) }));

vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth }));
vi.mock("~/lib/leaderboardAutomatic", () => automatic);
vi.mock("~/lib/device", () => device);

import { AutomaticEnrollmentIdentityCoordinator } from "../../client/components/AutomaticEnrollmentIdentityCoordinator";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("automatic enrollment identity coordinator", () => {
  let root: Root | undefined;

  // reset one auth transition fixture
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    auth.isAuthenticated = true;
    auth.isLoading = false;
    auth.user = { sub: "auth0|one" };
    automatic.checkAutomaticEnrollmentIdentity.mockResolvedValue({
      bound: true,
      matches: true,
      schemaVersion: 1,
    });
    automatic.checkAutomaticEnrollmentCleanup.mockResolvedValue({
      matches: false,
      pending: false,
      schemaVersion: 1,
      valid: true,
    });
    automatic.getAutomaticEnrollmentCapability.mockResolvedValue({
      capabilityVersion: 1,
      enabled: true,
      manualFallbackAvailable: true,
      platform: "ios",
      schemaVersion: 1,
      supported: true,
    });
    automatic.getAutomaticLeaderboardPlugin.mockResolvedValue({ native: true });
    device.isNativeMobileApp.mockReturnValue(true);
    vi.clearAllMocks();
  });

  // render one identity observation
  const render = async (): Promise<void> => {
    // create one stable react root
    if (!root) {
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    // run one bounded callback
    await act(async () => {
      root?.render(<AutomaticEnrollmentIdentityCoordinator />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  // purge unprovable native ownership on anonymous cold start
  it("purges persisted native identity on an anonymous startup", async () => {
    auth.isAuthenticated = false;
    auth.user = undefined;

    await render();

    expect(
      automatic.invalidateAutomaticEnrollmentOperations
    ).toHaveBeenCalledOnce();
    expect(automatic.disableAutomaticLeaderboardCheckins).toHaveBeenCalledWith(
      "identity_lost"
    );
  });

  // preserve a same-subject device proof across one cold restart
  it("preserves a valid same-subject native identity across restart", async () => {
    await render();
    act(() => root?.unmount());
    root = undefined;
    await render();

    expect(automatic.checkAutomaticEnrollmentIdentity).toHaveBeenCalledTimes(2);
    expect(automatic.disableAutomaticLeaderboardAccount).not.toHaveBeenCalled();
    expect(
      automatic.disableAutomaticLeaderboardCheckins
    ).not.toHaveBeenCalled();
    expect(auth.getAccessTokenSilently).not.toHaveBeenCalled();
  });

  // converge an exact pending cleanup locally without account-wide revocation
  it("replays exact cleanup ownership before ordinary identity checks", async () => {
    automatic.checkAutomaticEnrollmentCleanup.mockResolvedValueOnce({
      matches: true,
      pending: true,
      schemaVersion: 1,
      valid: true,
    });

    await render();

    expect(automatic.disableAutomaticLeaderboardCheckins).toHaveBeenCalledWith(
      "identity_lost",
      { native: true }
    );
    expect(automatic.checkAutomaticEnrollmentIdentity).not.toHaveBeenCalled();
    expect(automatic.disableAutomaticLeaderboardAccount).not.toHaveBeenCalled();
    expect(auth.getAccessTokenSilently).not.toHaveBeenCalled();
  });

  // preserve another subject's cleanup marker without server authority
  it("never revokes an account for a mismatched cleanup owner", async () => {
    automatic.checkAutomaticEnrollmentCleanup.mockResolvedValueOnce({
      matches: false,
      pending: true,
      schemaVersion: 1,
      valid: true,
    });

    await render();

    expect(automatic.checkAutomaticEnrollmentIdentity).toHaveBeenCalledOnce();
    expect(
      automatic.disableAutomaticLeaderboardCheckins
    ).not.toHaveBeenCalled();
    expect(automatic.disableAutomaticLeaderboardAccount).not.toHaveBeenCalled();
    expect(auth.getAccessTokenSilently).not.toHaveBeenCalled();
  });

  // keep unsupported and default-off native capability inert
  it.each([
    { enabled: false, supported: true },
    { enabled: true, supported: false },
  ])("does not inspect ownership for an inert capability", async (state) => {
    automatic.getAutomaticEnrollmentCapability.mockResolvedValueOnce({
      capabilityVersion: 1,
      manualFallbackAvailable: true,
      platform: "ios",
      schemaVersion: 1,
      ...state,
    });

    await render();

    expect(automatic.checkAutomaticEnrollmentIdentity).not.toHaveBeenCalled();
    expect(automatic.disableAutomaticLeaderboardAccount).not.toHaveBeenCalled();
    expect(auth.getAccessTokenSilently).not.toHaveBeenCalled();
  });

  // keep missing native ownership cleanup local to this device
  it("does not revoke sibling enrollments when the bridge is missing", async () => {
    automatic.getAutomaticLeaderboardPlugin.mockResolvedValueOnce(null);

    await render();

    expect(automatic.disableAutomaticLeaderboardCheckins).toHaveBeenCalledWith(
      "identity_lost",
      null
    );
    expect(automatic.disableAutomaticLeaderboardAccount).not.toHaveBeenCalled();
    expect(auth.getAccessTokenSilently).not.toHaveBeenCalled();
  });

  // keep ordinary web authentication free of native cleanup
  it("does not revoke native ownership from an ordinary web session", async () => {
    automatic.getAutomaticLeaderboardPlugin.mockResolvedValueOnce(null);
    device.isNativeMobileApp.mockReturnValueOnce(false);

    await render();

    expect(automatic.disableAutomaticLeaderboardAccount).not.toHaveBeenCalled();
  });

  // keep a clean second device from revoking the first device
  it("purges only local unbound identity on a clean second device", async () => {
    automatic.checkAutomaticEnrollmentIdentity.mockResolvedValueOnce({
      bound: false,
      matches: false,
      schemaVersion: 1,
    });

    await render();

    expect(automatic.disableAutomaticLeaderboardCheckins).toHaveBeenCalledWith(
      "identity_lost",
      { native: true }
    );
    expect(automatic.disableAutomaticLeaderboardAccount).not.toHaveBeenCalled();
    expect(auth.getAccessTokenSilently).not.toHaveBeenCalled();
  });

  // invalidate before purging an authenticated-to-anonymous transition
  it("purges the old native identity when authentication ends", async () => {
    await render();
    vi.clearAllMocks();

    auth.isAuthenticated = false;
    auth.user = undefined;
    await render();

    expect(
      automatic.invalidateAutomaticEnrollmentOperations.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      automatic.disableAutomaticLeaderboardCheckins.mock.invocationCallOrder[0]
    );
    expect(automatic.disableAutomaticLeaderboardCheckins).toHaveBeenCalledWith(
      "identity_lost"
    );
  });

  // purge before a replacement account can own native material
  it("purges the old native identity on account switch", async () => {
    await render();
    vi.clearAllMocks();
    automatic.checkAutomaticEnrollmentIdentity.mockResolvedValueOnce({
      bound: true,
      matches: false,
      schemaVersion: 1,
    });
    auth.user = { sub: "auth0|two" };
    await render();

    expect(
      automatic.invalidateAutomaticEnrollmentOperations
    ).toHaveBeenCalledOnce();
    expect(automatic.disableAutomaticLeaderboardCheckins).toHaveBeenCalledWith(
      "identity_lost",
      { native: true }
    );
    expect(automatic.disableAutomaticLeaderboardAccount).not.toHaveBeenCalled();
    expect(auth.getAccessTokenSilently).not.toHaveBeenCalled();
  });

  // fail closed locally when native ownership is corrupt or unreadable
  it("purges only local state for an unverifiable native identity", async () => {
    automatic.checkAutomaticEnrollmentIdentity.mockRejectedValueOnce(
      new Error("corrupt proof")
    );

    await render();

    expect(automatic.disableAutomaticLeaderboardCheckins).toHaveBeenCalledWith(
      "identity_lost",
      { native: true }
    );
    expect(automatic.disableAutomaticLeaderboardAccount).not.toHaveBeenCalled();
    expect(auth.getAccessTokenSilently).not.toHaveBeenCalled();
  });
});
