// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// expose one mutable auth fixture
const auth = vi.hoisted(() => ({
  // run one bounded callback
  getAccessTokenSilently: vi.fn(async () => "access-token"),
  isAuthenticated: true,
  user: { sub: "auth0|fixture" },
}));
// expose one mutable admission fixture
const flags = vi.hoisted(() => ({
  automaticLeaderboardCheckinsEnabled: true,
  leaderboardsEnabled: true,
}));
// expose one native bridge fixture
const automatic = vi.hoisted(() => ({
  assertAutomaticEnrollmentOperation: vi.fn(),
  beginAutomaticEnrollmentOperation: vi.fn(() => ({
    currentSubject: () => "auth0|fixture",
    generation: 1,
    subject: "auth0|fixture",
  })),
  cancelAutomaticEnrollmentOperation: vi.fn(),
  // run one bounded callback
  checkAutomaticEnrollmentCleanup: vi.fn(async () => ({
    matches: false,
    pending: false,
    schemaVersion: 1,
    valid: true,
  })),
  // run one bounded callback
  disableAutomaticLeaderboardAccount: vi.fn(async () => undefined),
  // run one bounded callback
  disableAutomaticLeaderboardCheckins: vi.fn(async () => undefined),
  enrollAutomaticLeaderboardCheckins: vi.fn(),
  getAutomaticEnrollmentCapability: vi.fn(),
  getAutomaticEnrollmentStatus: vi.fn(),
  getAutomaticLeaderboardPlugin: vi.fn(),
  isAutomaticEnrollmentCleanupDurabilityError: vi.fn(() => false),
  isAutomaticEnrollmentCleanupRequiredError: vi.fn(() => false),
  isAutomaticEnrollmentHealthy: vi.fn(
    (status: { monitorHealth?: string }) => status.monitorHealth === "healthy"
  ),
  listenForAutomaticLeaderboardChanges: vi.fn(),
  openAutomaticEnrollmentSettings: vi.fn(),
  requestAutomaticEnrollmentPermissions: vi.fn(),
  retryAutomaticEnrollmentCleanup: vi.fn(),
}));
// expose one server preference fixture
const leaderboards = vi.hoisted(() => ({
  getLeaderboardPreferences: vi.fn(),
  updateLeaderboardPreferences: vi.fn(),
}));

vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth }));
vi.mock("~/lib/device", () => ({ isNativeMobileApp: () => true }));
vi.mock("~/lib/featureFlags", () => ({
  useFeatureFlags: () => ({
    automaticLeaderboardCheckinsEnabled:
      flags.automaticLeaderboardCheckinsEnabled,
    leaderboardsEnabled: flags.leaderboardsEnabled,
    loading: false,
  }),
}));
vi.mock("~/lib/leaderboardAutomatic", () => automatic);
vi.mock("~/lib/leaderboards", () => leaderboards);

import {
  LeaderboardAutomaticCleanupRecovery,
  LeaderboardAutomaticEnrollment,
} from "../../client/components/LeaderboardAutomaticEnrollment";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// provide one healthy aggregate fixture
const healthyStatus = {
  capabilityVersion: 1,
  configGeneration: 4,
  credentialExpiryBucket: "seven_days_or_more",
  lastOutcome: null,
  monitorHealth: "healthy",
  pendingCandidateCount: 0,
  permissionHealth: "authorized",
  platform: "android",
  schemaVersion: 1,
  serverPolicyGeneration: 8,
} as const;
// provide one disabled preference fixture
const offPreferences = {
  automaticCheckinsEnabled: false,
  displayName: "AF",
  notificationsEnabled: true,
  optedOut: false,
  useFullName: false,
  verboseNotificationsEnabled: false,
};

// create one controlled asynchronous fixture
const deferred = <T,>() => {
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>(
    // retain one controlled release callback
    (done) => {
      resolve = done;
    }
  );
  return { promise, resolve };
};

describe("automatic enrollment ui", () => {
  let root: Root | undefined;

  // reset one client fixture
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.clearAllMocks();
    auth.isAuthenticated = true;
    auth.user = { sub: "auth0|fixture" };
    flags.automaticLeaderboardCheckinsEnabled = true;
    flags.leaderboardsEnabled = true;
    automatic.isAutomaticEnrollmentCleanupDurabilityError.mockReturnValue(
      false
    );
    automatic.isAutomaticEnrollmentCleanupRequiredError.mockReturnValue(false);
    automatic.checkAutomaticEnrollmentCleanup.mockResolvedValue({
      matches: false,
      pending: false,
      schemaVersion: 1,
      valid: true,
    });
    automatic.isAutomaticEnrollmentHealthy.mockImplementation(
      (status: { monitorHealth?: string }) => status.monitorHealth === "healthy"
    );
  });

  // render one explicit native disclosure and complete the enable barrier
  it("requires disclosure consent and reports healthy completion accessibly", async () => {
    const plugin = { getCapability: vi.fn() };
    automatic.getAutomaticLeaderboardPlugin.mockResolvedValue(plugin);
    automatic.getAutomaticEnrollmentCapability.mockResolvedValue({
      androidSdkInt: 36,
      capabilityVersion: 1,
      enabled: true,
      platform: "android",
      schemaVersion: 1,
      supported: true,
    });
    automatic.getAutomaticEnrollmentStatus.mockResolvedValue(healthyStatus);
    automatic.listenForAutomaticLeaderboardChanges.mockResolvedValue(null);
    automatic.requestAutomaticEnrollmentPermissions.mockResolvedValue({
      permissionHealth: "authorized",
      schemaVersion: 1,
      settingsOpened: false,
    });
    automatic.enrollAutomaticLeaderboardCheckins.mockResolvedValue({
      preferencesEnabled: true,
      status: healthyStatus,
    });
    leaderboards.getLeaderboardPreferences.mockResolvedValue({
      ...offPreferences,
      automaticCheckinsEnabled: true,
    });
    const onPreferencesChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    // run one bounded callback
    await act(async () => {
      root?.render(
        <LeaderboardAutomaticEnrollment
          disabled={false}
          onPreferencesChange={onPreferencesChange}
          preferences={offPreferences}
        />
      );
      await Promise.resolve();
    });

    const section = container.querySelector(
      'section[aria-labelledby="automatic-checkins-title"]'
    );
    const enable = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Enable automatic")
    );
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain("becomes ineligible at 12 hours");
    expect(section?.textContent).toContain("not proof that you boarded");
    expect(enable?.disabled).toBe(true);

    // run one bounded callback
    await act(async () => {
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.click();
    });
    // run one bounded callback
    await act(async () => {
      enable?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      automatic.requestAutomaticEnrollmentPermissions
    ).toHaveBeenCalledWith(plugin);
    expect(automatic.enrollAutomaticLeaderboardCheckins).toHaveBeenCalledWith(
      "access-token",
      plugin,
      expect.objectContaining({ subject: "auth0|fixture" })
    );
    expect(
      automatic.requestAutomaticEnrollmentPermissions.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      automatic.enrollAutomaticLeaderboardCheckins.mock.invocationCallOrder[0]
    );
    expect(onPreferencesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ automaticCheckinsEnabled: true })
    );
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "active"
    );
  });

  // refetch aggregate and visible server state from an empty native signal
  it("refetches status without consuming event detail", async () => {
    let changed: (() => void) | undefined;
    automatic.getAutomaticEnrollmentStatus.mockResolvedValue(healthyStatus);
    automatic.getAutomaticEnrollmentCapability.mockResolvedValue({
      androidSdkInt: 36,
      capabilityVersion: 1,
      enabled: true,
      platform: "android",
      schemaVersion: 1,
      supported: true,
    });
    automatic.getAutomaticLeaderboardPlugin.mockResolvedValue({});
    automatic.listenForAutomaticLeaderboardChanges.mockImplementation(
      // run one bounded callback
      async (listener: () => void) => {
        changed = listener;
        return null;
      }
    );
    leaderboards.getLeaderboardPreferences.mockResolvedValue(offPreferences);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    // run one bounded callback
    await act(async () => {
      root?.render(
        <LeaderboardAutomaticEnrollment
          disabled={false}
          onPreferencesChange={vi.fn()}
          preferences={offPreferences}
        />
      );
      await Promise.resolve();
    });
    vi.clearAllMocks();

    // run one bounded callback
    await act(async () => {
      changed?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(automatic.getAutomaticEnrollmentStatus).toHaveBeenCalledWith();
    expect(leaderboards.getLeaderboardPreferences).toHaveBeenCalledWith(
      "access-token"
    );
  });

  // discard delayed status and preference reads from a prior auth subject
  it("never applies a delayed prior-subject enrollment refresh", async () => {
    const firstStatus = deferred<typeof healthyStatus>();
    const onPreferencesChange = vi.fn();
    automatic.getAutomaticEnrollmentCapability.mockResolvedValue({
      androidSdkInt: 36,
      capabilityVersion: 1,
      enabled: true,
      platform: "android",
      schemaVersion: 1,
      supported: true,
    });
    automatic.getAutomaticEnrollmentStatus
      .mockImplementationOnce(async () => await firstStatus.promise)
      .mockResolvedValueOnce({ ...healthyStatus, serverPolicyGeneration: 9 });
    automatic.getAutomaticLeaderboardPlugin.mockResolvedValue({});
    automatic.listenForAutomaticLeaderboardChanges.mockResolvedValue(null);
    auth.getAccessTokenSilently
      .mockResolvedValueOnce("token-one")
      .mockResolvedValueOnce("token-two");
    leaderboards.getLeaderboardPreferences.mockImplementation(async (token) =>
      token === "token-two"
        ? { ...offPreferences, displayName: "Subject Two" }
        : { ...offPreferences, displayName: "Subject One" }
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    // run one bounded callback
    await act(async () => {
      root?.render(
        <LeaderboardAutomaticEnrollment
          disabled={false}
          onPreferencesChange={onPreferencesChange}
          preferences={offPreferences}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    auth.user = { sub: "auth0|two" };
    // run one bounded callback
    await act(async () => {
      root?.render(
        <LeaderboardAutomaticEnrollment
          disabled={false}
          onPreferencesChange={onPreferencesChange}
          preferences={offPreferences}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onPreferencesChange).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Subject Two" })
    );
    // run one bounded callback
    await act(async () => {
      firstStatus.resolve(healthyStatus);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onPreferencesChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Subject One" })
    );
  });

  // keep unsupported builds inert before disclosure or permission work
  it("reports the api floor without showing disclosure or requesting permission", async () => {
    automatic.getAutomaticLeaderboardPlugin.mockResolvedValue({});
    automatic.getAutomaticEnrollmentCapability.mockResolvedValue({
      androidSdkInt: 28,
      capabilityVersion: 1,
      enabled: false,
      platform: "android",
      schemaVersion: 1,
      supported: false,
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    // run one bounded callback
    await act(async () => {
      root?.render(
        <LeaderboardAutomaticEnrollment
          disabled={false}
          onPreferencesChange={vi.fn()}
          preferences={offPreferences}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Android 10 or newer");
    expect(container.textContent).not.toContain("short-lived encrypted");
    expect(
      automatic.requestAutomaticEnrollmentPermissions
    ).not.toHaveBeenCalled();
    expect(automatic.getAutomaticEnrollmentStatus).not.toHaveBeenCalled();
  });

  // keep default-off builds inert before disclosure or permission work
  it("reports an unavailable build without requesting native permission", async () => {
    automatic.getAutomaticLeaderboardPlugin.mockResolvedValue({});
    automatic.getAutomaticEnrollmentCapability.mockResolvedValue({
      androidSdkInt: 36,
      capabilityVersion: 1,
      enabled: false,
      platform: "android",
      schemaVersion: 1,
      supported: true,
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    // run one bounded callback
    await act(async () => {
      root?.render(
        <LeaderboardAutomaticEnrollment
          disabled={false}
          onPreferencesChange={vi.fn()}
          preferences={offPreferences}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("unavailable in this app build");
    expect(container.textContent).not.toContain("short-lived encrypted");
    expect(
      automatic.requestAutomaticEnrollmentPermissions
    ).not.toHaveBeenCalled();
  });

  // report malformed native permission results as unavailable
  it("does not reinterpret an invalid permission result as a denial", async () => {
    const plugin = {};
    automatic.getAutomaticLeaderboardPlugin.mockResolvedValue(plugin);
    automatic.getAutomaticEnrollmentCapability.mockResolvedValue({
      androidSdkInt: 36,
      capabilityVersion: 1,
      enabled: true,
      platform: "android",
      schemaVersion: 1,
      supported: true,
    });
    automatic.getAutomaticEnrollmentStatus.mockResolvedValue(healthyStatus);
    automatic.listenForAutomaticLeaderboardChanges.mockResolvedValue(null);
    automatic.requestAutomaticEnrollmentPermissions.mockRejectedValue(
      new Error("automatic native permission status unavailable")
    );
    leaderboards.getLeaderboardPreferences.mockResolvedValue(offPreferences);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    // run one bounded callback
    await act(async () => {
      root?.render(
        <LeaderboardAutomaticEnrollment
          disabled={false}
          onPreferencesChange={vi.fn()}
          preferences={offPreferences}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // run one bounded callback
    await act(async () => {
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.click();
    });
    // run one bounded callback
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Enable automatic"))
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "Native permission status could not be verified"
    );
    expect(container.textContent).not.toContain(
      "Required precise background location is not authorized"
    );
    expect(automatic.enrollAutomaticLeaderboardCheckins).not.toHaveBeenCalled();
  });

  // distinguish aggregate status failure from an inert capability
  it("keeps eligible capability visible while status is unavailable", async () => {
    automatic.getAutomaticLeaderboardPlugin.mockResolvedValue({});
    automatic.getAutomaticEnrollmentCapability.mockResolvedValue({
      androidSdkInt: 36,
      capabilityVersion: 1,
      enabled: true,
      platform: "android",
      schemaVersion: 1,
      supported: true,
    });
    automatic.getAutomaticEnrollmentStatus.mockResolvedValue(null);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    // run one bounded callback
    await act(async () => {
      root?.render(
        <LeaderboardAutomaticEnrollment
          disabled={false}
          onPreferencesChange={vi.fn()}
          preferences={offPreferences}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "Native status could not be verified"
    );
    expect(container.textContent).toContain("status is unavailable");
    expect(container.textContent).not.toContain("Automatic check-ins are off");
  });

  // offer actionable settings and manual fallback for degraded enrollment
  it("opens native settings from an enabled degraded state", async () => {
    const degradedStatus = {
      ...healthyStatus,
      monitorHealth: "background_refresh_off",
    };
    automatic.getAutomaticLeaderboardPlugin.mockResolvedValue({});
    automatic.getAutomaticEnrollmentCapability.mockResolvedValue({
      androidSdkInt: 36,
      capabilityVersion: 1,
      enabled: true,
      platform: "android",
      schemaVersion: 1,
      supported: true,
    });
    automatic.getAutomaticEnrollmentStatus.mockResolvedValue(degradedStatus);
    automatic.isAutomaticEnrollmentHealthy.mockReturnValue(false);
    automatic.listenForAutomaticLeaderboardChanges.mockResolvedValue(null);
    automatic.openAutomaticEnrollmentSettings.mockResolvedValue({
      schemaVersion: 1,
      settingsOpened: true,
    });
    leaderboards.getLeaderboardPreferences.mockResolvedValue({
      ...offPreferences,
      automaticCheckinsEnabled: true,
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    // run one bounded callback
    await act(async () => {
      root?.render(
        <LeaderboardAutomaticEnrollment
          disabled={false}
          onPreferencesChange={vi.fn()}
          preferences={{
            ...offPreferences,
            automaticCheckinsEnabled: true,
          }}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // run one bounded callback
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Review device settings")
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(automatic.openAutomaticEnrollmentSettings).toHaveBeenCalledOnce();
    expect(
      automatic.requestAutomaticEnrollmentPermissions
    ).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Use manual check-in");
  });

  // retain structured cleanup until every rollback boundary confirms
  it("offers cleanup retry without claiming a failed rollback was safe", async () => {
    const plugin = {};
    const cleanup = {
      cleanupProofCleared: false,
      enrollmentId: "123e4567-e89b-42d3-a456-426614174000",
      enrollmentRevoked: false,
      localPurged: true,
      preferenceDisabled: true,
      subjectVerified: true,
    };
    automatic.getAutomaticLeaderboardPlugin.mockResolvedValue(plugin);
    automatic.getAutomaticEnrollmentCapability.mockResolvedValue({
      androidSdkInt: 36,
      capabilityVersion: 1,
      enabled: true,
      platform: "android",
      schemaVersion: 1,
      supported: true,
    });
    automatic.getAutomaticEnrollmentStatus.mockResolvedValue(healthyStatus);
    automatic.listenForAutomaticLeaderboardChanges.mockResolvedValue(null);
    automatic.requestAutomaticEnrollmentPermissions.mockResolvedValue({
      permissionHealth: "authorized",
      schemaVersion: 1,
      settingsOpened: false,
    });
    automatic.enrollAutomaticLeaderboardCheckins.mockRejectedValue({ cleanup });
    automatic.isAutomaticEnrollmentCleanupRequiredError.mockReturnValue(true);
    leaderboards.getLeaderboardPreferences.mockResolvedValue(offPreferences);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    // run one bounded callback
    await act(async () => {
      root?.render(
        <LeaderboardAutomaticEnrollment
          disabled={false}
          onPreferencesChange={vi.fn()}
          preferences={offPreferences}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // run one bounded callback
    await act(async () => {
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.click();
    });
    // run one bounded callback
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Enable automatic"))
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("cleanup is still required");
    expect(container.textContent).not.toContain("nothing remains enabled");
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Retry cleanup"
      )
    ).toBe(true);
  });

  // block without offering retry when no durable cleanup owner exists
  it("reports marker-stage failure as non-recoverable in the current session", async () => {
    automatic.getAutomaticLeaderboardPlugin.mockResolvedValue({});
    automatic.getAutomaticEnrollmentCapability.mockResolvedValue({
      androidSdkInt: 36,
      capabilityVersion: 1,
      enabled: true,
      platform: "android",
      schemaVersion: 1,
      supported: true,
    });
    automatic.getAutomaticEnrollmentStatus.mockResolvedValue(healthyStatus);
    automatic.listenForAutomaticLeaderboardChanges.mockResolvedValue(null);
    automatic.requestAutomaticEnrollmentPermissions.mockResolvedValue({
      permissionHealth: "authorized",
      schemaVersion: 1,
      settingsOpened: false,
    });
    automatic.enrollAutomaticLeaderboardCheckins.mockRejectedValue({
      localPurged: true,
    });
    automatic.isAutomaticEnrollmentCleanupDurabilityError.mockReturnValue(true);
    leaderboards.getLeaderboardPreferences.mockResolvedValue(offPreferences);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    // run one bounded callback
    await act(async () => {
      root?.render(
        <LeaderboardAutomaticEnrollment
          disabled={false}
          onPreferencesChange={vi.fn()}
          preferences={offPreferences}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // run one bounded callback
    await act(async () => {
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.click();
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Enable automatic"))
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "cleanup recovery could not be secured"
    );
    expect(container.textContent).not.toContain("Retry cleanup");
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("Enable automatic")
      )
    ).toBe(false);
  });

  // recover one exact marker behind either closed rollout gate
  it.each([
    {
      automaticEnabled: false,
      label: "automatic rollout",
      leaderboardsEnabled: true,
      recoveryOnly: false,
    },
    {
      automaticEnabled: true,
      label: "parent rollout",
      leaderboardsEnabled: false,
      recoveryOnly: true,
    },
  ])(
    "surfaces and clears exact cleanup after remount with $label closed",
    // verify one true component restart for each rollout boundary
    async ({ automaticEnabled, leaderboardsEnabled, recoveryOnly }) => {
      flags.automaticLeaderboardCheckinsEnabled = automaticEnabled;
      flags.leaderboardsEnabled = leaderboardsEnabled;
      const plugin = {};
      automatic.getAutomaticLeaderboardPlugin.mockResolvedValue(plugin);
      automatic.getAutomaticEnrollmentCapability.mockResolvedValue({
        androidSdkInt: 36,
        capabilityVersion: 1,
        enabled: true,
        platform: "android",
        schemaVersion: 1,
        supported: true,
      });
      automatic.checkAutomaticEnrollmentCleanup.mockResolvedValue({
        matches: true,
        pending: true,
        schemaVersion: 1,
        valid: true,
      });
      automatic.getAutomaticEnrollmentStatus.mockResolvedValue(healthyStatus);
      automatic.retryAutomaticEnrollmentCleanup.mockImplementation(
        // acquire one token only after local cleanup begins
        async (...args: unknown[]) => {
          const getToken = args[2] as () => Promise<string>;
          await getToken();
        }
      );
      leaderboards.getLeaderboardPreferences.mockResolvedValue(offPreferences);
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      // run one bounded callback
      await act(async () => {
        root?.render(
          recoveryOnly ? (
            <LeaderboardAutomaticCleanupRecovery />
          ) : (
            <LeaderboardAutomaticEnrollment
              disabled={false}
              onPreferencesChange={vi.fn()}
              preferences={offPreferences}
            />
          )
        );
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      act(() => root?.unmount());
      root = createRoot(container);
      // run one bounded callback
      await act(async () => {
        root?.render(
          recoveryOnly ? (
            <LeaderboardAutomaticCleanupRecovery />
          ) : (
            <LeaderboardAutomaticEnrollment
              disabled={false}
              onPreferencesChange={vi.fn()}
              preferences={offPreferences}
            />
          )
        );
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.textContent).toContain("cleanup is still required");
      // run one bounded callback
      await act(async () => {
        [...container.querySelectorAll("button")]
          .find((button) => button.textContent === "Retry cleanup")
          ?.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(auth.getAccessTokenSilently).toHaveBeenCalledTimes(1);
      expect(automatic.retryAutomaticEnrollmentCleanup).toHaveBeenCalledWith(
        expect.objectContaining({ subjectVerified: true }),
        "auth0|fixture",
        expect.any(Function),
        plugin,
        {},
        expect.any(Function)
      );
      expect(automatic.getAutomaticEnrollmentCapability).not.toHaveBeenCalled();
      expect(
        automatic.requestAutomaticEnrollmentPermissions
      ).not.toHaveBeenCalled();
    }
  );

  // block corrupt cleanup ownership before token or server work
  it("keeps unverifiable cleanup local and token-free", async () => {
    flags.leaderboardsEnabled = false;
    automatic.getAutomaticLeaderboardPlugin.mockResolvedValue({});
    automatic.getAutomaticEnrollmentCapability.mockResolvedValue({
      androidSdkInt: 36,
      capabilityVersion: 1,
      enabled: true,
      platform: "android",
      schemaVersion: 1,
      supported: true,
    });
    automatic.checkAutomaticEnrollmentCleanup.mockResolvedValue({
      matches: false,
      pending: true,
      schemaVersion: 1,
      valid: false,
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    // run one bounded callback
    await act(async () => {
      root?.render(<LeaderboardAutomaticCleanupRecovery />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => root?.unmount());
    root = createRoot(container);
    // run one bounded callback
    await act(async () => {
      root?.render(<LeaderboardAutomaticCleanupRecovery />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain(
      "cleanup ownership could not be verified"
    );
    expect(container.textContent).not.toContain("Retry cleanup");
    expect(auth.getAccessTokenSilently).not.toHaveBeenCalled();
    expect(automatic.retryAutomaticEnrollmentCleanup).not.toHaveBeenCalled();
    expect(automatic.getAutomaticEnrollmentCapability).not.toHaveBeenCalled();
  });

  // preserve another account's cleanup marker without server authority
  it("blocks enrollment for a mismatched cleanup owner without retry", async () => {
    flags.automaticLeaderboardCheckinsEnabled = false;
    automatic.getAutomaticLeaderboardPlugin.mockResolvedValue({});
    automatic.getAutomaticEnrollmentCapability.mockResolvedValue({
      androidSdkInt: 36,
      capabilityVersion: 1,
      enabled: true,
      platform: "android",
      schemaVersion: 1,
      supported: true,
    });
    automatic.checkAutomaticEnrollmentCleanup.mockResolvedValue({
      matches: false,
      pending: true,
      schemaVersion: 1,
      valid: true,
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    // run one bounded callback
    await act(async () => {
      root?.render(
        <LeaderboardAutomaticEnrollment
          disabled={false}
          onPreferencesChange={vi.fn()}
          preferences={offPreferences}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => root?.unmount());
    root = createRoot(container);
    // run one bounded callback
    await act(async () => {
      root?.render(
        <LeaderboardAutomaticEnrollment
          disabled={false}
          onPreferencesChange={vi.fn()}
          preferences={offPreferences}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "cleanup belongs to another signed-in account"
    );
    expect(container.textContent).not.toContain("Retry cleanup");
    expect(auth.getAccessTokenSilently).not.toHaveBeenCalled();
    expect(automatic.retryAutomaticEnrollmentCleanup).not.toHaveBeenCalled();
    expect(automatic.getAutomaticEnrollmentCapability).not.toHaveBeenCalled();
  });

  // keep anonymous native surfaces inert before capability work
  it("does not touch the native bridge for an unauthenticated subject", async () => {
    auth.isAuthenticated = false;
    auth.user = undefined as never;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    // run one bounded callback
    await act(async () => {
      root?.render(
        <LeaderboardAutomaticEnrollment
          disabled={false}
          onPreferencesChange={vi.fn()}
          preferences={offPreferences}
        />
      );
      await Promise.resolve();
    });

    expect(container.textContent).toBe("");
    expect(automatic.getAutomaticLeaderboardPlugin).not.toHaveBeenCalled();
    expect(automatic.getAutomaticEnrollmentCapability).not.toHaveBeenCalled();
  });
});
