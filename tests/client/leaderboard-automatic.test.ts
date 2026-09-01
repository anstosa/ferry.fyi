import { afterEach, describe, expect, it, vi } from "vitest";

const capacitor = vi.hoisted(() => ({
  isPluginAvailable: vi.fn(() => true),
  isNativePlatform: vi.fn(() => true),
  registerPlugin: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: capacitor.isNativePlatform,
    isPluginAvailable: capacitor.isPluginAvailable,
  },
  registerPlugin: capacitor.registerPlugin,
}));

import {
  assertAutomaticEnrollmentOperation,
  AUTOMATIC_LEADERBOARD_CHANGED_EVENT,
  AutomaticEnrollmentCleanupDurabilityError,
  AutomaticEnrollmentCleanupRequiredError,
  type AutomaticLeaderboardCheckinsPluginV1,
  beginAutomaticEnrollmentOperation,
  bindAutomaticEnrollmentIdentity,
  checkAutomaticEnrollmentCleanup,
  checkAutomaticEnrollmentIdentity,
  clearAutomaticEnrollmentCleanup,
  disableAutomaticLeaderboardAccount,
  disableAutomaticLeaderboardCheckins,
  enrollAutomaticLeaderboardCheckins,
  getAutomaticLeaderboardPlugin,
  isAutomaticEnrollmentHealthy,
  listenForAutomaticLeaderboardChanges,
  openAutomaticEnrollmentSettings,
  parseAutomaticEnrollmentBootstrap,
  parseAutomaticEnrollmentCapability,
  parseAutomaticEnrollmentStatus,
  requestAutomaticEnrollmentPermissions,
  retryAutomaticEnrollmentCleanup,
  stageAutomaticEnrollmentCleanup,
} from "../../client/lib/leaderboardAutomatic";
import type {
  AutomaticEnrollmentCredentialV1,
  AutomaticEnrollmentStatusV1,
  LeaderboardPreferences,
} from "../../shared/contracts/leaderboards";

// build one aggregate native status fixture
const status = (
  overrides: Partial<AutomaticEnrollmentStatusV1> = {}
): AutomaticEnrollmentStatusV1 => ({
  capabilityVersion: 1,
  configGeneration: 9,
  credentialExpiryBucket: "seven_days_or_more",
  lastOutcome: null,
  monitorHealth: "healthy",
  pendingCandidateCount: 0,
  permissionHealth: "authorized",
  platform: "android",
  schemaVersion: 1,
  serverPolicyGeneration: 7,
  ...overrides,
});

// provide one exact server credential fixture
const credential: AutomaticEnrollmentCredentialV1 = {
  bearerToken: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  enrollmentId: "123e4567-e89b-42d3-a456-426614174000",
  expiresAtMs: 1_800_000_000_000,
  rotateAfterMs: 1_799_000_000_000,
  schemaVersion: 1,
  scopes: [
    "automatic-checkins:config:read",
    "automatic-checkins:status:read",
    "automatic-checkins:candidates:write",
    "automatic-checkins:enrollment:revoke",
  ],
  serverPolicyGeneration: 7,
  urls: {
    candidates: "https://ferry.fyi/api/leaderboards/native/v1/candidates",
    config: "https://ferry.fyi/api/leaderboards/native/v1/config",
    enrollment: "https://ferry.fyi/api/leaderboards/native/v1/enrollment",
    status: "https://ferry.fyi/api/leaderboards/native/v1/status",
  },
};

// provide one enabled preference fixture
const preferences: LeaderboardPreferences = {
  automaticCheckinsEnabled: true,
  displayName: "AF",
  notificationsEnabled: true,
  optedOut: false,
  useFullName: false,
  verboseNotificationsEnabled: false,
};

// build one deterministic native bridge
const plugin = (
  overrides: Partial<AutomaticLeaderboardCheckinsPluginV1> = {}
): AutomaticLeaderboardCheckinsPluginV1 => ({
  // run one bounded callback
  addListener: vi.fn(async () => ({
    // remove one fixture listener
    remove: vi.fn(async () => undefined),
  })),
  // run one bounded callback
  bindIdentity: vi.fn(async () => ({ bound: true, schemaVersion: 1 })),
  // run one bounded callback
  checkIdentity: vi.fn(async () => ({
    bound: true,
    matches: true,
    schemaVersion: 1,
  })),
  // run one bounded callback
  checkEnrollmentCleanup: vi.fn(async () => ({
    matches: false,
    pending: false,
    schemaVersion: 1,
    valid: true,
  })),
  // run one bounded callback
  clearEnrollmentCleanup: vi.fn(async () => ({
    cleared: true,
    schemaVersion: 1,
  })),
  // run one bounded callback
  disableAndPurge: vi.fn(async () => ({ purged: true })),
  // run one bounded callback
  getCapability: vi.fn(async () => ({
    androidSdkInt: 36,
    capabilityVersion: 1,
    enabled: true,
    platform: "android",
    schemaVersion: 1,
    supported: true,
  })),
  // run one bounded callback
  getEnrollmentBootstrap: vi.fn(async () => ({
    androidSdkInt: 36,
    capabilityVersion: 1,
    enabled: true,
    installationNonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    manualFallbackAvailable: true,
    platform: "android",
    schemaVersion: 1,
    supported: true,
  })),
  // run one bounded callback
  getStatus: vi.fn(async () => status()),
  // run one bounded callback
  installCredential: vi.fn(async () => ({ installed: true })),
  // run one bounded callback
  openAutomaticCheckinSettings: vi.fn(async () => ({
    schemaVersion: 1,
    settingsOpened: true,
  })),
  // run one bounded callback
  reconcile: vi.fn(async () => ({ outcome: "applied" })),
  // run one bounded callback
  requestBackgroundLocationPermission: vi.fn(async () => ({
    permissionHealth: "authorized",
    schemaVersion: 1,
    settingsOpened: false,
  })),
  // run one bounded callback
  requestForegroundLocationPermission: vi.fn(async () => ({
    permissionHealth: "authorized",
    schemaVersion: 1,
    settingsOpened: false,
  })),
  // run one bounded callback
  stageEnrollmentCleanup: vi.fn(async () => ({
    schemaVersion: 1,
    staged: true,
  })),
  ...overrides,
});

// bind one operation to a mutable auth subject
const operation = (subjectRef = { current: "auth0|one" }) =>
  beginAutomaticEnrollmentOperation(
    "auth0|one",
    // expose one current fixture owner
    () => subjectRef.current
  );

// create one deterministic asynchronous barrier
const deferred = () => {
  let resolve = (): void => undefined;
  const promise = new Promise<void>(
    // retain one controlled release callback
    (done) => {
      resolve = done;
    }
  );
  return { promise, resolve };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("automatic leaderboard client boundary", () => {
  // prevent capacitor proxy promise assimilation
  it("loads the native plugin without invoking a synthetic then method", async () => {
    const bridge = plugin();
    const syntheticThen = vi.fn(() => {
      throw new Error(
        '"AutomaticLeaderboardCheckins.then()" is not implemented on android'
      );
    });
    const capacitorProxy = new Proxy(bridge, {
      // reproduce capacitor's dynamic plugin method lookup
      get(target, property, receiver) {
        // expose the synthetic method that breaks async returns
        if (property === "then") {
          return syntheticThen;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    vi.stubGlobal("window", {
      Capacitor: { isNativePlatform: capacitor.isNativePlatform },
    });
    capacitor.registerPlugin.mockReturnValue(capacitorProxy);
    const safePlugin = await getAutomaticLeaderboardPlugin();

    expect(safePlugin).not.toBeNull();
    await expect(safePlugin?.getStatus()).resolves.toEqual(status());
    expect(capacitor.registerPlugin).toHaveBeenCalledWith(
      "AutomaticLeaderboardCheckins"
    );
    expect(syntheticThen).not.toHaveBeenCalled();
  });

  // keep missing native bridges inert
  it("returns no plugin when the native bridge is unavailable", async () => {
    vi.stubGlobal("window", {
      Capacitor: { isNativePlatform: capacitor.isNativePlatform },
    });
    capacitor.isPluginAvailable.mockReturnValueOnce(false);

    await expect(getAutomaticLeaderboardPlugin()).resolves.toBeNull();
    expect(capacitor.registerPlugin).not.toHaveBeenCalled();
  });

  // reject one stale owner before the next asynchronous phase
  it("binds enrollment operations to the current auth subject", () => {
    const subject = { current: "auth0|one" };
    const currentOperation = operation(subject);

    expect(() =>
      assertAutomaticEnrollmentOperation(currentOperation)
    ).not.toThrow();
    subject.current = "auth0|two";
    expect(() => assertAutomaticEnrollmentOperation(currentOperation)).toThrow(
      "cancelled"
    );
  });

  // validate strict privacy projections
  it("accepts only exact bootstrap and aggregate status keys", () => {
    const bridge = plugin();
    const bootstrap = {
      androidSdkInt: 36,
      capabilityVersion: 1,
      enabled: true,
      installationNonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      manualFallbackAvailable: true,
      platform: "android",
      schemaVersion: 1,
      supported: true,
    } as const;
    const capability = {
      androidSdkInt: 36,
      capabilityVersion: 1,
      enabled: true,
      platform: "android",
      schemaVersion: 1,
      supported: true,
    } as const;

    expect(parseAutomaticEnrollmentCapability(capability)).toEqual(capability);
    expect(
      parseAutomaticEnrollmentCapability({ ...capability, terminalId: "7" })
    ).toBeNull();
    expect(
      parseAutomaticEnrollmentCapability({
        ...capability,
        androidSdkInt: 28,
        enabled: false,
        supported: true,
      })
    ).toBeNull();
    expect(
      parseAutomaticEnrollmentCapability({
        ...capability,
        enabled: true,
        supported: false,
      })
    ).toBeNull();
    expect(parseAutomaticEnrollmentBootstrap(bootstrap)).toEqual(bootstrap);
    expect(
      parseAutomaticEnrollmentBootstrap({ ...bootstrap, terminalId: "7" })
    ).toBeNull();
    expect(
      parseAutomaticEnrollmentBootstrap({ ...bootstrap, enabled: false })
    ).toBeNull();
    expect(
      parseAutomaticEnrollmentBootstrap({
        ...bootstrap,
        installationNonce: `${"A".repeat(42)}B`,
      })
    ).toBeNull();
    expect(parseAutomaticEnrollmentStatus(status())).toEqual(status());
    expect(
      parseAutomaticEnrollmentStatus({ ...status(), localWorkGeneration: 4 })
    ).toBeNull();
    expect(isAutomaticEnrollmentHealthy(status())).toBe(true);
    expect(
      isAutomaticEnrollmentHealthy(status({ monitorHealth: "stale_config" }))
    ).toBe(false);
    expect(bridge).toBeDefined();
  });

  // prove permission sequencing
  it("requests foreground before background and stops on incomplete authority", async () => {
    const order: string[] = [];
    const complete = plugin({
      // run one bounded callback
      requestBackgroundLocationPermission: vi.fn(async () => {
        order.push("background");
        return {
          permissionHealth: "authorized",
          schemaVersion: 1,
          settingsOpened: false,
        };
      }),
      // run one bounded callback
      requestForegroundLocationPermission: vi.fn(async () => {
        order.push("foreground");
        return {
          permissionHealth: "authorized",
          schemaVersion: 1,
          settingsOpened: false,
        };
      }),
    });

    await expect(
      requestAutomaticEnrollmentPermissions(complete)
    ).resolves.toEqual({
      permissionHealth: "authorized",
      schemaVersion: 1,
      settingsOpened: false,
    });
    expect(order).toEqual(["foreground", "background"]);

    const deniedBackground = vi.fn();
    const denied = plugin({
      requestBackgroundLocationPermission: deniedBackground,
      // run one bounded callback
      requestForegroundLocationPermission: vi.fn(async () => ({
        permissionHealth: "limited_accuracy",
        schemaVersion: 1,
        settingsOpened: false,
      })),
    });
    await expect(
      requestAutomaticEnrollmentPermissions(denied)
    ).resolves.toMatchObject({ permissionHealth: "limited_accuracy" });
    expect(deniedBackground).not.toHaveBeenCalled();

    const malformedBackground = vi.fn();
    const malformed = plugin({
      requestBackgroundLocationPermission: malformedBackground,
      requestForegroundLocationPermission: vi.fn(
        async () =>
          ({
            permissionHealth: "authorized",
            schemaVersion: 1,
            settingsOpened: false,
            terminalId: "7",
          }) as never
      ),
    });
    await expect(
      requestAutomaticEnrollmentPermissions(malformed)
    ).rejects.toThrow("native permission status unavailable");
    expect(malformedBackground).not.toHaveBeenCalled();

    complete.requestBackgroundLocationPermission = vi.fn(
      async () =>
        ({
          permissionHealth: "authorized",
          schemaVersion: 1,
          settingsOpened: false,
          terminalId: "7",
        }) as never
    );
    await expect(
      requestAutomaticEnrollmentPermissions(complete)
    ).rejects.toThrow("native permission status unavailable");

    await expect(openAutomaticEnrollmentSettings(complete)).resolves.toEqual({
      schemaVersion: 1,
      settingsOpened: true,
    });
    complete.openAutomaticCheckinSettings = vi.fn(
      async () =>
        ({ schemaVersion: 1, settingsOpened: true, terminalId: "7" }) as never
    );
    await expect(openAutomaticEnrollmentSettings(complete)).rejects.toThrow(
      "settings result was invalid"
    );
  });

  // require exact detail-free native identity proof projections
  it("rejects malformed identity binding and check results", async () => {
    const complete = plugin();

    await expect(
      bindAutomaticEnrollmentIdentity("auth0|fixture", complete)
    ).resolves.toBeUndefined();
    await expect(
      checkAutomaticEnrollmentIdentity("auth0|fixture", complete)
    ).resolves.toEqual({ bound: true, matches: true, schemaVersion: 1 });

    complete.bindIdentity = vi.fn(
      async () =>
        ({ bound: true, schemaVersion: 1, subject: "forbidden" }) as never
    );
    await expect(
      bindAutomaticEnrollmentIdentity("auth0|fixture", complete)
    ).rejects.toThrow("identity binding failed");
    complete.checkIdentity = vi.fn(
      async () => ({ bound: false, matches: true, schemaVersion: 1 }) as never
    );
    await expect(
      checkAutomaticEnrollmentIdentity("auth0|fixture", complete)
    ).rejects.toThrow("identity proof unavailable");
  });

  // require exact detail-free durable cleanup projections
  it("rejects malformed cleanup proof results", async () => {
    const complete = plugin();

    await expect(
      stageAutomaticEnrollmentCleanup("auth0|fixture", complete)
    ).resolves.toBe(true);
    await expect(
      checkAutomaticEnrollmentCleanup("auth0|fixture", complete)
    ).resolves.toEqual({
      matches: false,
      pending: false,
      schemaVersion: 1,
      valid: true,
    });
    await expect(
      clearAutomaticEnrollmentCleanup("auth0|fixture", complete)
    ).resolves.toBe(true);

    complete.checkEnrollmentCleanup = vi.fn(
      async () =>
        ({
          matches: true,
          pending: false,
          schemaVersion: 1,
          valid: true,
        }) as never
    );
    await expect(
      checkAutomaticEnrollmentCleanup("auth0|fixture", complete)
    ).rejects.toThrow("cleanup proof unavailable");
  });

  // prove the all-or-off activation barrier
  it("sets the preference only after native health is acknowledged", async () => {
    const order: string[] = [];
    const bridge = plugin({
      // run one bounded callback
      getEnrollmentBootstrap: vi.fn(async () => {
        order.push("bootstrap");
        return {
          androidSdkInt: 36,
          capabilityVersion: 1,
          enabled: true,
          installationNonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          manualFallbackAvailable: true,
          platform: "android",
          schemaVersion: 1,
          supported: true,
        };
      }),
      // run one bounded callback
      getStatus: vi.fn(async () => {
        order.push("status");
        return status();
      }),
      // run one bounded callback
      installCredential: vi.fn(async () => {
        order.push("install");
        return { installed: true };
      }),
      // run one bounded callback
      bindIdentity: vi.fn(async () => {
        order.push("bind");
        return { bound: true, schemaVersion: 1 };
      }),
      // run one bounded callback
      reconcile: vi.fn(async () => {
        order.push("reconcile");
        return { outcome: "applied" };
      }),
    });

    await expect(
      enrollAutomaticLeaderboardCheckins("token", bridge, operation(), {
        // run one bounded callback
        createEnrollment: vi.fn(async (request) => {
          order.push("create");
          expect(request).not.toHaveProperty("replacesEnrollmentId");
          return credential;
        }),
        // run one bounded callback
        pause: vi.fn(async () => undefined),
        // run one bounded callback
        updateHealth: vi.fn(async () => {
          order.push("health");
          return {
            enrollment: {
              active: true,
              capabilityVersion: 1,
              detectorEnabled: true,
              enrollmentId: credential.enrollmentId,
              expiresAtMs: credential.expiresAtMs,
              health: "healthy",
              platform: "android",
              revokedAtMs: null,
            },
            schemaVersion: 1,
            serverPolicyGeneration: 8,
          };
        }),
        // run one bounded callback
        updatePreferences: vi.fn(async () => {
          order.push("preference");
          return preferences;
        }),
      })
    ).resolves.toEqual({ preferencesEnabled: true, status: status() });

    expect(order).toEqual([
      "bootstrap",
      "create",
      "install",
      "bind",
      "reconcile",
      "status",
      "health",
      "preference",
    ]);
  });

  // prove partial enrollment rollback
  it("purges and revokes a partial enrollment without enabling preference", async () => {
    const rollbackOrder: string[] = [];
    const bridge = plugin({
      // run one bounded callback
      clearEnrollmentCleanup: vi.fn(async () => {
        rollbackOrder.push("clear-proof");
        return { cleared: true, schemaVersion: 1 };
      }),
      // run one bounded callback
      disableAndPurge: vi.fn(async () => {
        rollbackOrder.push("purge");
        return { purged: true };
      }),
      // run one bounded callback
      installCredential: vi.fn(async () => ({ installed: false })),
      // run one bounded callback
      stageEnrollmentCleanup: vi.fn(async () => {
        rollbackOrder.push("stage-proof");
        return { schemaVersion: 1, staged: true };
      }),
    });
    const disableEnrollments = vi.fn(async () => {
      rollbackOrder.push("server-disable");
      return { disabled: true, schemaVersion: 1, serverPolicyGeneration: 8 };
    });
    const updatePreferences = vi.fn(async () => {
      return {
        ...preferences,
        automaticCheckinsEnabled: false,
      };
    });

    await expect(
      enrollAutomaticLeaderboardCheckins("token", bridge, operation(), {
        // run one bounded callback
        createEnrollment: vi.fn(async () => credential),
        disableEnrollments,
        // run one bounded callback
        pause: vi.fn(async () => undefined),
        updateHealth: vi.fn(),
        updatePreferences,
      })
    ).rejects.toThrow("credential installation");

    expect(bridge.disableAndPurge).toHaveBeenCalledWith({
      reason: "local_disable",
    });
    expect(disableEnrollments).toHaveBeenCalledWith("token", "auth0|one");
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(rollbackOrder).toEqual([
      "stage-proof",
      "purge",
      "server-disable",
      "clear-proof",
    ]);
  });

  // stop locally without claiming recoverable rollback when marker staging fails
  it("fails closed before server rollback without durable cleanup ownership", async () => {
    const bridge = plugin({
      // run one bounded callback
      installCredential: vi.fn(async () => ({ installed: false })),
      // run one bounded callback
      stageEnrollmentCleanup: vi.fn(async () => ({
        schemaVersion: 1,
        staged: false,
      })),
    });
    const disableEnrollments = vi.fn();

    await expect(
      enrollAutomaticLeaderboardCheckins("token", bridge, operation(), {
        // create one partial server enrollment
        createEnrollment: vi.fn(async () => credential),
        disableEnrollments,
        // avoid real polling delay
        pause: vi.fn(async () => undefined),
        updateHealth: vi.fn(),
        updatePreferences: vi.fn(),
      })
    ).rejects.toMatchObject({
      localPurged: true,
      name: "AutomaticEnrollmentCleanupDurabilityError",
    });
    expect(bridge.disableAndPurge).toHaveBeenCalledOnce();
    expect(disableEnrollments).not.toHaveBeenCalled();
    expect(bridge.clearEnrollmentCleanup).not.toHaveBeenCalled();
  });

  // prove every failed rollback step remains cleanup-required
  it.each(["purge", "server"] as const)(
    "surfaces cleanup_required when %s confirmation fails",
    // run one bounded callback
    async (failure) => {
      const bridge = plugin({
        // run one bounded callback
        disableAndPurge: vi.fn(async () => {
          // inject one local cleanup failure
          if (failure === "purge") {
            throw new Error("purge failed");
          }
          return { purged: true };
        }),
        // run one bounded callback
        installCredential: vi.fn(async () => ({ installed: false })),
      });
      const attempt = enrollAutomaticLeaderboardCheckins(
        "token",
        bridge,
        operation(),
        {
          // run one bounded callback
          createEnrollment: vi.fn(async () => credential),
          // run one bounded callback
          disableEnrollments: vi.fn(async () => {
            // inject one ungated server cleanup failure
            if (failure === "server") {
              throw new Error("server cleanup failed");
            }
            return {
              disabled: true,
              schemaVersion: 1,
              serverPolicyGeneration: 8,
            };
          }),
          // run one bounded callback
          pause: vi.fn(async () => undefined),
          updateHealth: vi.fn(),
          updatePreferences: vi.fn(),
        }
      );

      await expect(attempt).rejects.toBeInstanceOf(
        AutomaticEnrollmentCleanupRequiredError
      );
      await attempt.catch((error: AutomaticEnrollmentCleanupRequiredError) => {
        expect(error.cleanup).toEqual({
          cleanupProofCleared: false,
          enrollmentId: credential.enrollmentId,
          enrollmentRevoked: false,
          localPurged: failure !== "purge",
          preferenceDisabled: false,
          subjectVerified: true,
        });
      });
    }
  );

  // retry only the rollback boundaries that remain unconfirmed
  it("retries incomplete cleanup without repeating confirmed effects", async () => {
    const bridge = plugin({
      // run one bounded callback
      checkEnrollmentCleanup: vi.fn(async () => ({
        matches: true,
        pending: true,
        schemaVersion: 1,
        valid: true,
      })),
    });
    const disableEnrollments = vi.fn();
    const updatePreferences = vi.fn(async () => ({
      ...preferences,
      automaticCheckinsEnabled: false,
    }));

    await expect(
      retryAutomaticEnrollmentCleanup(
        {
          cleanupProofCleared: false,
          enrollmentId: credential.enrollmentId,
          enrollmentRevoked: true,
          localPurged: false,
          preferenceDisabled: true,
          subjectVerified: true,
        },
        "auth0|one",
        "token",
        bridge,
        { disableEnrollments, updatePreferences }
      )
    ).resolves.toBeUndefined();

    expect(bridge.disableAndPurge).toHaveBeenCalledOnce();
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(disableEnrollments).not.toHaveBeenCalled();
  });

  // order one rollout-independent cleanup retry through exact authority
  it("purges locally before lazy token and ungated cleanup on retry", async () => {
    const order: string[] = [];
    const bridge = plugin({
      // record proof checks before any cleanup effect
      checkEnrollmentCleanup: vi.fn(async () => {
        order.push("check");
        return { matches: true, pending: true, schemaVersion: 1, valid: true };
      }),
      // clear only after exact server acknowledgement
      clearEnrollmentCleanup: vi.fn(async () => {
        order.push("clear");
        return { cleared: true, schemaVersion: 1 };
      }),
      // record local purge before token acquisition
      disableAndPurge: vi.fn(async () => {
        order.push("purge");
        return { purged: true };
      }),
      // preserve one exact cleanup owner
      stageEnrollmentCleanup: vi.fn(async () => {
        order.push("stage");
        return { schemaVersion: 1, staged: true };
      }),
    });
    // acquire authenticated authority only after local purge
    const getAccessToken = vi.fn(async () => {
      order.push("token");
      return "token";
    });
    // record one ungated account-wide cleanup acknowledgement
    const disableEnrollments = vi.fn(async () => {
      order.push("server");
      return { disabled: true, schemaVersion: 1, serverPolicyGeneration: 8 };
    });

    await expect(
      retryAutomaticEnrollmentCleanup(
        {
          cleanupProofCleared: false,
          enrollmentId: null,
          enrollmentRevoked: false,
          localPurged: false,
          preferenceDisabled: false,
          subjectVerified: true,
        },
        "auth0|one",
        getAccessToken,
        bridge,
        { disableEnrollments }
      )
    ).resolves.toBeUndefined();

    expect(order).toEqual([
      "check",
      "stage",
      "purge",
      "token",
      "server",
      "clear",
    ]);
  });

  // retry one response-lost server cleanup through the ungated authority
  it("derives cleanup_required until account-wide disable confirms after restart", async () => {
    let cleanupOwner: string | null = null;
    // create one process-replaceable native marker fixture
    const cleanupBridge = (
      installed = false
    ): AutomaticLeaderboardCheckinsPluginV1 =>
      plugin({
        // run one bounded callback
        checkEnrollmentCleanup: vi.fn(async ({ subject }) => ({
          matches: cleanupOwner === subject,
          pending: cleanupOwner !== null,
          schemaVersion: 1,
          valid: true,
        })),
        // run one bounded callback
        clearEnrollmentCleanup: vi.fn(async ({ subject }) => {
          const cleared = cleanupOwner === null || cleanupOwner === subject;
          // clear only the exact owner
          if (cleared) {
            cleanupOwner = null;
          }
          return { cleared, schemaVersion: 1 };
        }),
        // run one bounded callback
        installCredential: vi.fn(async () => ({ installed })),
        // run one bounded callback
        stageEnrollmentCleanup: vi.fn(async ({ subject }) => {
          cleanupOwner = subject;
          return { schemaVersion: 1, staged: true };
        }),
      });
    const bridge = cleanupBridge();
    const failed = enrollAutomaticLeaderboardCheckins(
      "token",
      bridge,
      operation(),
      {
        // run one bounded callback
        createEnrollment: vi.fn(async () => credential),
        // run one bounded callback
        disableEnrollments: vi.fn(async () => {
          throw new Error("response lost");
        }),
        // run one bounded callback
        pause: vi.fn(async () => undefined),
        updateHealth: vi.fn(),
        updatePreferences: vi.fn(),
      }
    );
    const cleanup = await failed.catch(
      (error: AutomaticEnrollmentCleanupRequiredError) => error.cleanup
    );
    const disableEnrollments = vi.fn(async () => ({
      disabled: true as const,
      schemaVersion: 1 as const,
      serverPolicyGeneration: 9,
    }));
    const replacement = cleanupBridge();

    await expect(
      checkAutomaticEnrollmentCleanup("auth0|one", replacement)
    ).resolves.toEqual({
      matches: true,
      pending: true,
      schemaVersion: 1,
      valid: true,
    });
    await expect(
      checkAutomaticEnrollmentCleanup("auth0|other", replacement)
    ).resolves.toEqual({
      matches: false,
      pending: true,
      schemaVersion: 1,
      valid: true,
    });

    await expect(
      retryAutomaticEnrollmentCleanup(
        cleanup,
        "auth0|one",
        "token",
        replacement,
        {
          disableEnrollments,
        }
      )
    ).resolves.toBeUndefined();
    expect(disableEnrollments).toHaveBeenCalledWith("token", "auth0|one");
    expect(cleanupOwner).toBeNull();

    const reenrollmentBridge = cleanupBridge(true);
    await expect(
      checkAutomaticEnrollmentCleanup("auth0|one", reenrollmentBridge)
    ).resolves.toEqual({
      matches: false,
      pending: false,
      schemaVersion: 1,
      valid: true,
    });
    await expect(
      enrollAutomaticLeaderboardCheckins(
        "token",
        reenrollmentBridge,
        operation(),
        {
          // return one replacement server credential
          createEnrollment: vi.fn(async () => credential),
          // avoid real polling delay
          pause: vi.fn(async () => undefined),
          // confirm one healthy replacement enrollment
          updateHealth: vi.fn(async () => ({
            enrollment: {
              active: true,
              capabilityVersion: 1,
              detectorEnabled: true,
              enrollmentId: credential.enrollmentId,
              expiresAtMs: credential.expiresAtMs,
              health: "healthy",
              platform: "android",
              revokedAtMs: null,
            },
            schemaVersion: 1,
            serverPolicyGeneration: 9,
          })),
          // commit preference only after replacement health
          updatePreferences: vi.fn(async () => preferences),
        }
      )
    ).resolves.toEqual({ preferencesEnabled: true, status: status() });
  });

  // never authorize account cleanup for a mismatched durable owner
  it("blocks mismatched cleanup retry before token-bound server work", async () => {
    const disableEnrollments = vi.fn();

    await expect(
      retryAutomaticEnrollmentCleanup(
        {
          cleanupProofCleared: false,
          enrollmentId: null,
          enrollmentRevoked: false,
          localPurged: false,
          preferenceDisabled: false,
          subjectVerified: false,
        },
        "auth0|other",
        "token",
        plugin(),
        { disableEnrollments }
      )
    ).rejects.toBeInstanceOf(AutomaticEnrollmentCleanupRequiredError);
    expect(disableEnrollments).not.toHaveBeenCalled();
  });

  // recheck durable ownership before stale react state can authorize cleanup
  it("rejects a changed cleanup proof without overwriting or server cleanup", async () => {
    const disableEnrollments = vi.fn();
    const bridge = plugin({
      // run one bounded callback
      checkEnrollmentCleanup: vi.fn(async () => ({
        matches: false,
        pending: true,
        schemaVersion: 1,
        valid: true,
      })),
    });

    await expect(
      retryAutomaticEnrollmentCleanup(
        {
          cleanupProofCleared: false,
          enrollmentId: null,
          enrollmentRevoked: false,
          localPurged: true,
          preferenceDisabled: false,
          subjectVerified: true,
        },
        "auth0|one",
        "token",
        bridge,
        { disableEnrollments }
      )
    ).rejects.toBeInstanceOf(AutomaticEnrollmentCleanupRequiredError);
    expect(bridge.stageEnrollmentCleanup).not.toHaveBeenCalled();
    expect(bridge.disableAndPurge).not.toHaveBeenCalled();
    expect(disableEnrollments).not.toHaveBeenCalled();
  });

  // block auth teardown until local purge and account-wide revocation confirm
  it("orders local purge before the authenticated revocation transaction", async () => {
    const order: string[] = [];
    const bridge = plugin({
      // record proof clearing after server acknowledgement
      clearEnrollmentCleanup: vi.fn(async () => {
        order.push("clear");
        return { cleared: true, schemaVersion: 1 };
      }),
      // record local purge before token acquisition
      disableAndPurge: vi.fn(async () => {
        order.push("purge");
        return { purged: true };
      }),
      // record durable staging before local purge
      stageEnrollmentCleanup: vi.fn(async () => {
        order.push("stage");
        return { schemaVersion: 1, staged: true };
      }),
    });
    // record token acquisition after local purge
    const getAccessToken = vi.fn(async () => {
      order.push("token");
      return "token";
    });
    // record account-wide server cleanup
    const disableEnrollments = vi.fn(async () => {
      order.push("revoke");
      return { disabled: true, schemaVersion: 1, serverPolicyGeneration: 8 };
    });

    await expect(
      disableAutomaticLeaderboardAccount(
        "identity_lost",
        "auth0|one",
        // preserve one exact active subject
        () => "auth0|one",
        getAccessToken,
        bridge,
        {
          disableEnrollments,
        }
      )
    ).resolves.toBeUndefined();
    expect(order).toEqual(["stage", "purge", "token", "revoke", "clear"]);
    expect(disableEnrollments).toHaveBeenCalledWith("token", "auth0|one");

    // reject one later local purge
    bridge.disableAndPurge = vi.fn(async () => ({ purged: false }));
    getAccessToken.mockClear();
    disableEnrollments.mockClear();
    await expect(
      disableAutomaticLeaderboardAccount(
        "identity_lost",
        "auth0|one",
        // preserve one exact active subject
        () => "auth0|one",
        getAccessToken,
        bridge,
        {
          disableEnrollments,
        }
      )
    ).rejects.toBeInstanceOf(AutomaticEnrollmentCleanupRequiredError);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(disableEnrollments).not.toHaveBeenCalled();
  });

  // fail closed when durable cleanup ownership cannot be staged
  it("purges locally without starting server cleanup after marker failure", async () => {
    const bridge = plugin({
      // reject one durable marker stage
      stageEnrollmentCleanup: vi.fn(async () => ({
        schemaVersion: 1,
        staged: false,
      })),
    });
    // expose one token callback that must stay unused
    const getAccessToken = vi.fn(async () => "token");
    const disableEnrollments = vi.fn();

    await expect(
      disableAutomaticLeaderboardAccount(
        "identity_lost",
        "auth0|one",
        // preserve one exact active subject
        () => "auth0|one",
        getAccessToken,
        bridge,
        { disableEnrollments }
      )
    ).rejects.toBeInstanceOf(AutomaticEnrollmentCleanupDurabilityError);
    expect(bridge.disableAndPurge).toHaveBeenCalledOnce();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(disableEnrollments).not.toHaveBeenCalled();
    expect(bridge.clearEnrollmentCleanup).not.toHaveBeenCalled();
  });

  // keep default-off native builds inert during authenticated teardown
  it("skips durable marker work when native capability is explicitly inert", async () => {
    const bridge = plugin({
      // return one supported default-off production capability
      getCapability: vi.fn(async () => ({
        androidSdkInt: 36,
        capabilityVersion: 1,
        enabled: false,
        platform: "android",
        schemaVersion: 1,
        supported: true,
      })),
      // reject any unexpected secure marker access
      stageEnrollmentCleanup: vi.fn(async () => ({
        schemaVersion: 1,
        staged: false,
      })),
    });
    // return one exact server acknowledgement
    const disableEnrollments = vi.fn(async () => ({
      disabled: true,
      schemaVersion: 1,
      serverPolicyGeneration: 9,
    }));

    await expect(
      disableAutomaticLeaderboardAccount(
        "identity_lost",
        "auth0|one",
        // preserve one exact active subject
        () => "auth0|one",
        // return one exact fixture token
        async () => "token",
        bridge,
        { disableEnrollments }
      )
    ).resolves.toBeUndefined();
    expect(bridge.stageEnrollmentCleanup).not.toHaveBeenCalled();
    expect(bridge.disableAndPurge).toHaveBeenCalledOnce();
    expect(bridge.clearEnrollmentCleanup).not.toHaveBeenCalled();
    expect(disableEnrollments).toHaveBeenCalledWith("token", "auth0|one");
  });

  // keep local purge first when auth0 renewal fails
  it("purges locally before a failed token renewal blocks auth teardown", async () => {
    const bridge = plugin();
    // reject one post-purge token acquisition
    const getAccessToken = vi.fn(async () => {
      throw new Error("login required");
    });
    const disableEnrollments = vi.fn();

    await expect(
      disableAutomaticLeaderboardAccount(
        "identity_lost",
        "auth0|one",
        // preserve one exact active subject
        () => "auth0|one",
        getAccessToken,
        bridge,
        {
          disableEnrollments,
        }
      )
    ).rejects.toThrow("login required");

    expect(bridge.disableAndPurge).toHaveBeenCalledOnce();
    expect(getAccessToken).toHaveBeenCalledOnce();
    expect(disableEnrollments).not.toHaveBeenCalled();
  });

  // retain subject a's marker when token acquisition switches to subject b
  it("rejects an auth subject switch before server mutation or marker clear", async () => {
    const subject = { current: "auth0|one" };
    let cleanupOwner: string | null = null;
    const bridge = plugin({
      // clear only the exact staged fixture owner
      clearEnrollmentCleanup: vi.fn(async ({ subject: candidate }) => {
        const cleared = cleanupOwner === candidate;
        // clear only one exact fixture proof
        if (cleared) {
          cleanupOwner = null;
        }
        return { cleared, schemaVersion: 1 };
      }),
      // stage one exact fixture owner
      stageEnrollmentCleanup: vi.fn(async ({ subject: candidate }) => {
        cleanupOwner = candidate;
        return { schemaVersion: 1, staged: true };
      }),
    });
    const disableEnrollments = vi.fn();
    // replace the active subject during token acquisition
    const getAccessToken = vi.fn(async () => {
      subject.current = "auth0|two";
      return "subject-b-token";
    });

    await expect(
      disableAutomaticLeaderboardAccount(
        "identity_lost",
        "auth0|one",
        // read the mutable active subject
        () => subject.current,
        getAccessToken,
        bridge,
        { disableEnrollments }
      )
    ).rejects.toThrow("owner changed");
    expect(cleanupOwner).toBe("auth0|one");
    expect(disableEnrollments).not.toHaveBeenCalled();
    expect(bridge.clearEnrollmentCleanup).not.toHaveBeenCalled();
  });

  // retain subject a's marker when auth0 returns a subject-b token first
  it("binds the server request when token replacement leads auth state", async () => {
    let cleanupOwner: string | null = null;
    const disabledSubjects: string[] = [];
    const bridge = plugin({
      // expose one exact fixture clear boundary
      clearEnrollmentCleanup: vi.fn(async () => {
        cleanupOwner = null;
        return { cleared: true, schemaVersion: 1 };
      }),
      // stage one exact fixture owner
      stageEnrollmentCleanup: vi.fn(async ({ subject }) => {
        cleanupOwner = subject;
        return { schemaVersion: 1, staged: true };
      }),
    });
    // model the server's expected-subject comparison before mutation
    const disableEnrollments = vi.fn(
      // run one bounded callback
      async (accessToken: string, expectedSubject: string) => {
        const tokenSubject =
          accessToken === "subject-b-token" ? "auth0|two" : "auth0|one";
        // reject the replaced token without mutating subject b
        if (tokenSubject !== expectedSubject) {
          throw new Error("automatic_cleanup_subject_changed");
        }
        disabledSubjects.push(tokenSubject);
        return {
          disabled: true,
          schemaVersion: 1,
          serverPolicyGeneration: 9,
        };
      }
    );

    await expect(
      disableAutomaticLeaderboardAccount(
        "identity_lost",
        "auth0|one",
        // model auth context lagging behind token replacement
        () => "auth0|one",
        // return the replaced subject-b token
        async () => "subject-b-token",
        bridge,
        { disableEnrollments }
      )
    ).rejects.toThrow("automatic_cleanup_subject_changed");
    expect(disabledSubjects).toEqual([]);
    expect(cleanupOwner).toBe("auth0|one");
    expect(bridge.clearEnrollmentCleanup).not.toHaveBeenCalled();
  });

  // retain the exact marker when auth changes after server acknowledgement
  it("rechecks the active subject before clearing an acknowledged marker", async () => {
    const subject = { current: "auth0|one" };
    let cleanupOwner: string | null = null;
    const bridge = plugin({
      // expose one exact fixture clear boundary
      clearEnrollmentCleanup: vi.fn(async () => {
        cleanupOwner = null;
        return { cleared: true, schemaVersion: 1 };
      }),
      // stage one exact fixture owner
      stageEnrollmentCleanup: vi.fn(async ({ subject: candidate }) => {
        cleanupOwner = candidate;
        return { schemaVersion: 1, staged: true };
      }),
    });
    // replace the active subject after one server acknowledgement
    const disableEnrollments = vi.fn(async () => {
      subject.current = "auth0|two";
      return {
        disabled: true,
        schemaVersion: 1,
        serverPolicyGeneration: 9,
      };
    });

    await expect(
      disableAutomaticLeaderboardAccount(
        "identity_lost",
        "auth0|one",
        // read the mutable active subject
        () => subject.current,
        // return one subject-a token
        async () => "subject-a-token",
        bridge,
        { disableEnrollments }
      )
    ).rejects.toThrow("owner changed");
    expect(disableEnrollments).toHaveBeenCalledWith(
      "subject-a-token",
      "auth0|one"
    );
    expect(cleanupOwner).toBe("auth0|one");
    expect(bridge.clearEnrollmentCleanup).not.toHaveBeenCalled();
  });

  // resume every explicit teardown only for the exact durable subject
  it.each(["identity_lost", "profile_opted_out", "account_deleted"] as const)(
    "recovers %s after response loss and process replacement",
    // exercise every explicit identity-ending reason
    async (reason) => {
      let cleanupOwner: string | null = null;
      // create one process-replaceable native cleanup boundary
      const cleanupBridge = (): AutomaticLeaderboardCheckinsPluginV1 =>
        plugin({
          // expose only aggregate exact-owner state
          checkEnrollmentCleanup: vi.fn(async ({ subject }) => ({
            matches: cleanupOwner === subject,
            pending: cleanupOwner !== null,
            schemaVersion: 1,
            valid: true,
          })),
          // clear only the exact durable owner
          clearEnrollmentCleanup: vi.fn(async ({ subject }) => {
            const cleared = cleanupOwner === null || cleanupOwner === subject;
            // preserve another subject's marker
            if (cleared) {
              cleanupOwner = null;
            }
            return { cleared, schemaVersion: 1 };
          }),
          // stage only a clean or already exact marker
          stageEnrollmentCleanup: vi.fn(async ({ subject }) => {
            const staged = cleanupOwner === null || cleanupOwner === subject;
            // preserve the first unresolved subject
            if (staged) {
              cleanupOwner = subject;
            }
            return { schemaVersion: 1, staged };
          }),
        });
      const disableEnrollments = vi
        .fn()
        .mockRejectedValueOnce(new Error("response lost"))
        .mockResolvedValue({
          disabled: true,
          schemaVersion: 1,
          serverPolicyGeneration: 9,
        });

      await expect(
        disableAutomaticLeaderboardAccount(
          reason,
          "auth0|one",
          // preserve one exact active subject
          () => "auth0|one",
          // return one exact fixture token
          async () => "token",
          cleanupBridge(),
          { disableEnrollments }
        )
      ).rejects.toThrow("response lost");
      expect(cleanupOwner).toBe("auth0|one");

      const replacement = cleanupBridge();
      await expect(
        checkAutomaticEnrollmentCleanup("auth0|other", replacement)
      ).resolves.toMatchObject({ matches: false, pending: true, valid: true });
      await expect(
        retryAutomaticEnrollmentCleanup(
          {
            cleanupProofCleared: false,
            enrollmentId: null,
            enrollmentRevoked: false,
            localPurged: false,
            preferenceDisabled: false,
            subjectVerified: true,
          },
          "auth0|other",
          "token",
          replacement,
          { disableEnrollments }
        )
      ).rejects.toBeInstanceOf(AutomaticEnrollmentCleanupRequiredError);
      expect(disableEnrollments).toHaveBeenCalledTimes(1);
      expect(cleanupOwner).toBe("auth0|one");

      await expect(
        retryAutomaticEnrollmentCleanup(
          {
            cleanupProofCleared: false,
            enrollmentId: null,
            enrollmentRevoked: false,
            localPurged: false,
            preferenceDisabled: false,
            subjectVerified: true,
          },
          "auth0|one",
          "token",
          replacement,
          { disableEnrollments }
        )
      ).resolves.toBeUndefined();
      expect(disableEnrollments).toHaveBeenCalledTimes(2);
      expect(cleanupOwner).toBeNull();
    }
  );

  // reject malformed server cleanup acknowledgements
  it("requires an exact account-wide disable acknowledgement", async () => {
    // return one malformed server acknowledgement
    const disableEnrollments = vi.fn(async () => ({
      disabled: true,
      schemaVersion: 1,
      serverPolicyGeneration: 8,
      terminalId: "forbidden",
    }));

    await expect(
      disableAutomaticLeaderboardAccount(
        "identity_lost",
        "auth0|one",
        // preserve one exact active subject
        () => "auth0|one",
        // return one exact fixture token
        async () => "token",
        null,
        {
          disableEnrollments,
        }
      )
    ).rejects.toThrow("revocation was not confirmed");
  });

  // revoke account-wide enrollment state even without a local native bridge
  it("confirms server revocation for web-only auth teardown", async () => {
    // return one exact server acknowledgement
    const disableEnrollments = vi.fn(async () => ({
      disabled: true,
      schemaVersion: 1,
      serverPolicyGeneration: 8,
    }));

    await expect(
      disableAutomaticLeaderboardAccount(
        "identity_lost",
        "auth0|one",
        // preserve one exact active subject
        () => "auth0|one",
        // return one exact fixture token
        async () => "token",
        undefined,
        {
          disableEnrollments,
        }
      )
    ).resolves.toBeUndefined();
    expect(disableEnrollments).toHaveBeenCalledWith("token", "auth0|one");
  });

  // reject new enrollment ownership while teardown is in progress
  it("keeps teardown exclusive until every cleanup effect finishes", async () => {
    const entered = deferred();
    const release = deferred();
    const bridge = plugin({
      // run one bounded callback
      disableAndPurge: vi.fn(async () => {
        entered.resolve();
        await release.promise;
        return { purged: true };
      }),
    });
    const teardown = disableAutomaticLeaderboardCheckins(
      "identity_lost",
      bridge
    );
    await entered.promise;

    expect(() => operation()).toThrow("cancelled");
    release.resolve();
    await expect(teardown).resolves.toBeUndefined();
    expect(() => operation()).not.toThrow();
  });

  // serialize teardown against every asynchronous activation barrier
  it.each([
    "bootstrap",
    "create",
    "install",
    "bind",
    "reconcile",
    "status",
    "health",
    "preference",
  ] as const)(
    "prevents stale enable after teardown races the %s barrier",
    // run one bounded callback
    async (barrier) => {
      const entered = deferred();
      const release = deferred();
      const block = async (name: typeof barrier): Promise<void> => {
        // block only the selected phase
        if (barrier === name) {
          entered.resolve();
          await release.promise;
        }
      };
      const preferenceValues: boolean[] = [];
      const disableEnrollments = vi.fn(async () => ({
        disabled: true as const,
        schemaVersion: 1 as const,
        serverPolicyGeneration: 9,
      }));
      const bridge = plugin({
        // run one bounded callback
        bindIdentity: vi.fn(async () => {
          await block("bind");
          return { bound: true, schemaVersion: 1 };
        }),
        // run one bounded callback
        getEnrollmentBootstrap: vi.fn(async () => {
          await block("bootstrap");
          return {
            androidSdkInt: 36,
            capabilityVersion: 1,
            enabled: true,
            installationNonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            manualFallbackAvailable: true,
            platform: "android",
            schemaVersion: 1,
            supported: true,
          };
        }),
        // run one bounded callback
        getStatus: vi.fn(async () => {
          await block("status");
          return status();
        }),
        // run one bounded callback
        installCredential: vi.fn(async () => {
          await block("install");
          return { installed: true };
        }),
        // run one bounded callback
        reconcile: vi.fn(async () => {
          await block("reconcile");
          return { outcome: "applied" };
        }),
      });
      const enrollment = enrollAutomaticLeaderboardCheckins(
        "token",
        bridge,
        operation(),
        {
          // run one bounded callback
          createEnrollment: vi.fn(async () => {
            await block("create");
            return credential;
          }),
          disableEnrollments,
          // run one bounded callback
          pause: vi.fn(async () => undefined),
          // run one bounded callback
          updateHealth: vi.fn(async () => {
            await block("health");
            return {
              enrollment: {
                active: true,
                capabilityVersion: 1,
                detectorEnabled: true,
                enrollmentId: credential.enrollmentId,
                expiresAtMs: credential.expiresAtMs,
                health: "healthy",
                platform: "android",
                revokedAtMs: null,
              },
              schemaVersion: 1,
              serverPolicyGeneration: 8,
            };
          }),
          // run one bounded callback
          updatePreferences: vi.fn(async (update) => {
            const enabled = update.automaticCheckinsEnabled === true;
            // block only the enable commit
            if (enabled) {
              await block("preference");
            }
            preferenceValues.push(enabled);
            return { ...preferences, automaticCheckinsEnabled: enabled };
          }),
        }
      );

      await entered.promise;
      const teardown = disableAutomaticLeaderboardCheckins(
        "identity_lost",
        bridge
      );
      release.resolve();

      await expect(enrollment).rejects.toThrow("cancelled");
      await expect(teardown).resolves.toBeUndefined();
      expect(disableEnrollments).toHaveBeenCalledWith("token", "auth0|one");
    }
  );

  // prove detail-free event and purge semantics
  it("ignores native event data and blocks incomplete purge", async () => {
    let callback: (() => void) | undefined;
    const listener = vi.fn();
    const bridge = plugin({
      // run one bounded callback
      addListener: vi.fn(async (eventName, value) => {
        expect(eventName).toBe(AUTOMATIC_LEADERBOARD_CHANGED_EVENT);
        callback = value;
        // run one bounded callback
        return { remove: vi.fn(async () => undefined) };
      }),
      // run one bounded callback
      disableAndPurge: vi.fn(async () => ({ purged: false })),
    });

    await listenForAutomaticLeaderboardChanges(listener, bridge);
    callback?.();
    expect(listener).toHaveBeenCalledWith();
    await expect(
      disableAutomaticLeaderboardCheckins("identity_lost", bridge)
    ).rejects.toThrow("could not be purged");
  });
});
