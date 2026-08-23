import { useAuth0 } from "@auth0/auth0-react";
import React, {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  AutomaticEnrollmentCapabilityV1,
  AutomaticEnrollmentStatusV1,
  LeaderboardPreferences,
} from "shared/contracts/leaderboards";

import { isNativeMobileApp } from "~/lib/device";
import { useFeatureFlags } from "~/lib/featureFlags";
import {
  assertAutomaticEnrollmentOperation,
  type AutomaticEnrollmentCleanupState,
  type AutomaticEnrollmentOperation,
  beginAutomaticEnrollmentOperation,
  cancelAutomaticEnrollmentOperation,
  checkAutomaticEnrollmentCleanup,
  disableAutomaticLeaderboardAccount,
  enrollAutomaticLeaderboardCheckins,
  getAutomaticEnrollmentCapability,
  getAutomaticEnrollmentStatus,
  getAutomaticLeaderboardPlugin,
  isAutomaticEnrollmentCleanupDurabilityError,
  isAutomaticEnrollmentCleanupRequiredError,
  isAutomaticEnrollmentHealthy,
  listenForAutomaticLeaderboardChanges,
  openAutomaticEnrollmentSettings,
  requestAutomaticEnrollmentPermissions,
  retryAutomaticEnrollmentCleanup,
} from "~/lib/leaderboardAutomatic";
import { getLeaderboardPreferences } from "~/lib/leaderboards";

interface Props {
  disabled: boolean;
  onPreferencesChange: (preferences: LeaderboardPreferences) => void;
  preferences: LeaderboardPreferences;
}

// provide inert preferences for cleanup-only recovery
const cleanupRecoveryPreferences: LeaderboardPreferences = {
  automaticCheckinsEnabled: false,
  displayName: "",
  notificationsEnabled: true,
  optedOut: false,
  supporterBadgeVisible: false,
  useFullName: false,
  verboseNotificationsEnabled: false,
};

// ignore preference updates outside rollout admission
const ignoreCleanupPreferenceUpdate = (): void => undefined;

// explain one privacy-minimal native health state
export const automaticEnrollmentStatusMessage = (
  status: AutomaticEnrollmentStatusV1 | null
): string => {
  // preserve a truthful not-configured state
  if (!status) {
    return "Automatic check-in status is unavailable. Retry before changing enrollment; manual check-in remains available.";
  }
  // preserve one explicit native disabled state
  if (status.monitorHealth === "disabled") {
    return "Automatic check-ins are off. Manual check-in remains available.";
  }
  // confirm every complete native gate
  if (isAutomaticEnrollmentHealthy(status)) {
    return status.pendingCandidateCount > 0
      ? "Automatic check-ins are active. Encrypted check-ins are waiting to sync."
      : "Automatic check-ins are active. Manual check-in remains available.";
  }
  // explain permission recovery
  if (status.permissionHealth === "limited_accuracy") {
    return "Precise location is required. Allow precise location in device settings, then retry.";
  }
  // explain authorization recovery
  if (
    status.permissionHealth === "denied" ||
    status.permissionHealth === "restricted" ||
    status.permissionHealth === "not_determined"
  ) {
    return status.platform === "ios"
      ? "Set Location to Always with Precise Location on, then retry."
      : "Allow precise location all the time in Android settings, then retry.";
  }
  // explain ios background refresh recovery
  if (status.monitorHealth === "background_refresh_off") {
    return "Turn on Background App Refresh for Ferry FYI, then retry.";
  }
  // explain first-unlock recovery
  if (status.monitorHealth === "first_unlock_required") {
    return "Unlock the device once after restart, then retry.";
  }
  // explain force-stop recovery
  if (status.monitorHealth === "force_stopped") {
    return "Open Ferry FYI after force-stopping or force-quitting it, then retry.";
  }
  // explain registration recovery
  if (
    status.monitorHealth === "geofence_unavailable" ||
    status.monitorHealth === "registration_failed"
  ) {
    return "Background monitoring is unavailable on this device. Manual check-in still works.";
  }
  return "Automatic check-ins need attention. Review device settings and retry; manual check-in still works.";
};

// render the explicit native-only automatic enrollment transaction
export const LeaderboardAutomaticEnrollment = ({
  disabled,
  onPreferencesChange,
  preferences,
}: Props): ReactElement | null => {
  const { getAccessTokenSilently, isAuthenticated, user } = useAuth0();
  const { automaticLeaderboardCheckinsEnabled, leaderboardsEnabled } =
    useFeatureFlags();
  // require both rollout decisions for new enrollment work
  const automaticEnrollmentAdmitted =
    leaderboardsEnabled && automaticLeaderboardCheckinsEnabled;
  const native = isNativeMobileApp();
  const [capability, setCapability] =
    useState<AutomaticEnrollmentCapabilityV1 | null>();
  const [cleanup, setCleanup] =
    useState<AutomaticEnrollmentCleanupState | null>(null);
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [status, setStatus] = useState<AutomaticEnrollmentStatusV1 | null>(
    null
  );
  const [working, setWorking] = useState(false);
  const currentSubjectRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const operationRef = useRef<AutomaticEnrollmentOperation | null>(null);
  currentSubjectRef.current = isAuthenticated && user?.sub ? user.sub : null;

  // verify one asynchronous result still belongs to this surface owner
  const isCurrentSubject = useCallback(
    (subject: string): boolean =>
      mountedRef.current && currentSubjectRef.current === subject,
    []
  );

  // cancel one mounted operation before this surface disappears
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // cancel only a currently owned operation
      if (operationRef.current) {
        cancelAutomaticEnrollmentOperation(operationRef.current);
        operationRef.current = null;
      }
    };
  }, []);

  // refresh only aggregate status and server preference
  const refresh = useCallback(async (): Promise<void> => {
    const subject = currentSubjectRef.current;
    // require one current authenticated owner
    if (!subject) {
      throw new Error("automatic status owner unavailable");
    }
    const [nextStatus, accessToken] = await Promise.all([
      getAutomaticEnrollmentStatus(),
      getAccessTokenSilently(),
    ]);
    // discard native and token results from a prior subject
    if (!isCurrentSubject(subject)) {
      return;
    }
    // reject invalid or unavailable native status
    if (!nextStatus) {
      throw new Error("automatic status unavailable");
    }
    const nextPreferences = await getLeaderboardPreferences(accessToken);
    // discard stale preferences after unmount or identity replacement
    if (!isCurrentSubject(subject)) {
      return;
    }
    setStatus(nextStatus);
    setStatusError(false);
    onPreferencesChange(nextPreferences);
  }, [getAccessTokenSilently, isCurrentSubject, onPreferencesChange]);

  // recover durable cleanup before checking rollout admission or capability
  useEffect(() => {
    // keep web and anonymous builds free of native cleanup work
    if (!native || !isAuthenticated || !user?.sub) {
      return;
    }
    const subject = user.sub;
    let active = true;
    // hide prior-subject native state before loading
    setCapability(undefined);
    setCleanup(null);
    setError(null);
    setStatus(null);
    setStatusError(false);
    getAutomaticLeaderboardPlugin()
      // load one subject-bound native bridge
      .then(async (plugin) => {
        // require one native bridge before cleanup parsing
        if (!plugin) {
          throw new Error("automatic capability unavailable");
        }
        const cleanupProof = await checkAutomaticEnrollmentCleanup(
          subject,
          plugin
        );
        // discard stale cleanup proof after identity replacement
        if (!active || !isCurrentSubject(subject)) {
          return;
        }
        // block enrollment while any device cleanup marker remains unresolved
        if (cleanupProof.pending) {
          let cleanupMessage =
            "Automatic cleanup ownership could not be verified. Automatic enrollment remains blocked; manual check-in remains available.";
          // offer retry only to the exact durable owner
          if (cleanupProof.matches) {
            cleanupMessage =
              "Automatic enrollment cleanup is still required. Retry cleanup before enabling again.";
            // preserve another owner's marker without server authority
          } else if (cleanupProof.valid) {
            cleanupMessage =
              "Automatic cleanup belongs to another signed-in account. Automatic enrollment remains blocked on this device; manual check-in remains available.";
          }
          setCleanup({
            cleanupProofCleared: false,
            enrollmentId: null,
            enrollmentRevoked: false,
            localPurged: false,
            preferenceDisabled: false,
            subjectVerified: cleanupProof.matches,
          });
          setError(cleanupMessage);
          return;
        }
        // prohibit capability and enrollment work outside rollout admission
        if (!automaticEnrollmentAdmitted) {
          return;
        }
        const nextCapability = await getAutomaticEnrollmentCapability(plugin);
        // reject malformed native capability
        if (!nextCapability) {
          throw new Error("automatic capability unavailable");
        }
        // discard stale updates after unmount or identity replacement
        if (!active || !isCurrentSubject(subject)) {
          return;
        }
        setCapability(nextCapability);
        // avoid status and permission work on inert builds
        if (!nextCapability.enabled || !nextCapability.supported) {
          return;
        }
        // preserve capability while reporting status independently
        await refresh().catch(
          // surface a truthful aggregate-status failure
          () => {
            // retain only one current subject failure
            if (active && isCurrentSubject(subject)) {
              setStatusError(true);
            }
          }
        );
      })
      .catch(
        // surface a truthful availability failure
        () => {
          // retain only one current subject failure
          if (active && isCurrentSubject(subject)) {
            setCapability(null);
            setStatusError(true);
          }
        }
      );
    // invalidate one subject-bound capability load
    return () => {
      active = false;
    };
  }, [
    automaticEnrollmentAdmitted,
    isAuthenticated,
    isCurrentSubject,
    native,
    refresh,
    user?.sub,
  ]);

  // refetch without consuming any native event detail
  useEffect(() => {
    // keep web builds free of native listeners
    if (
      !native ||
      !automaticLeaderboardCheckinsEnabled ||
      !capability?.enabled ||
      !capability.supported
    ) {
      return;
    }
    let remove: (() => Promise<void>) | null = null;
    let active = true;
    listenForAutomaticLeaderboardChanges(
      // refetch only aggregate state after invalidation
      () => {
        refresh().catch(
          // retain a truthful stale-status signal
          () => setStatusError(true)
        );
      }
    )
      .then(
        // retain one mounted listener
        (listener) => {
          // remove a late listener after unmount
          if (!active) {
            listener?.().catch(
              // ignore one late removal failure
              () => undefined
            );
            return;
          }
          remove = listener;
        }
      )
      .catch(
        // keep listener setup optional
        () => undefined
      );
    return () => {
      active = false;
      remove?.().catch(
        // ignore one cleanup removal failure
        () => undefined
      );
    };
  }, [automaticLeaderboardCheckinsEnabled, capability, native, refresh]);

  // complete every enablement barrier before setting the preference
  const enable = async (): Promise<void> => {
    const subject = currentSubjectRef.current;
    // require one current authenticated owner
    if (!subject) {
      setError("Sign in again before enabling automatic check-ins.");
      return;
    }
    const operation = beginAutomaticEnrollmentOperation(
      subject,
      () => currentSubjectRef.current
    );
    operationRef.current = operation;
    setWorking(true);
    setError(null);
    setCleanup(null);
    try {
      assertAutomaticEnrollmentOperation(operation);
      const plugin = await getAutomaticLeaderboardPlugin();
      assertAutomaticEnrollmentOperation(operation);
      // require the production native bridge
      if (!plugin) {
        throw new Error("automatic check-ins require the native app");
      }
      const permission = await requestAutomaticEnrollmentPermissions(plugin);
      assertAutomaticEnrollmentOperation(operation);
      // stop before credential creation until device authority is complete
      if (
        permission.permissionHealth !== "authorized" ||
        permission.settingsOpened
      ) {
        const nextStatus = await getAutomaticEnrollmentStatus(plugin);
        assertAutomaticEnrollmentOperation(operation);
        // update only while this surface owns the operation
        if (mountedRef.current) {
          setStatus(nextStatus);
          setStatusError(nextStatus === null);
          setError(
            permission.settingsOpened
              ? "Device settings opened. Allow location all the time, return here, then retry."
              : "Required precise background location is not authorized yet. Manual check-in remains available."
          );
        }
        return;
      }
      assertAutomaticEnrollmentOperation(operation);
      const accessToken = await getAccessTokenSilently();
      assertAutomaticEnrollmentOperation(operation);
      const result = await enrollAutomaticLeaderboardCheckins(
        accessToken,
        plugin,
        operation
      );
      assertAutomaticEnrollmentOperation(operation);
      // update only while this surface owns the operation
      if (!mountedRef.current) {
        return;
      }
      setStatus(result.status);
      const nextPreferences = await getLeaderboardPreferences(accessToken);
      assertAutomaticEnrollmentOperation(operation);
      // update only while this surface owns the operation
      if (!mountedRef.current) {
        return;
      }
      onPreferencesChange(nextPreferences);
      setConsented(false);
    } catch (caught) {
      // preserve cleanup state until every rollback step confirms
      if (isAutomaticEnrollmentCleanupRequiredError(caught)) {
        // update only a mounted recovery surface
        if (mountedRef.current) {
          setCleanup(caught.cleanup);
          setError(
            "Automatic enrollment cleanup is still required. Retry cleanup before signing out or enabling again."
          );
        }
        // block this session without presenting an unowned retry
      } else if (isAutomaticEnrollmentCleanupDurabilityError(caught)) {
        // update only a mounted fail-closed surface
        if (mountedRef.current) {
          setCleanup({
            cleanupProofCleared: false,
            enrollmentId: null,
            enrollmentRevoked: false,
            localPurged: caught.localPurged,
            preferenceDisabled: false,
            subjectVerified: false,
          });
          setError(
            "Automatic cleanup recovery could not be secured. Automatic enrollment remains blocked in this app session; manual check-in remains available."
          );
        }
        // report a safe rollback only while still mounted
      } else if (mountedRef.current) {
        // distinguish an invalid native permission projection
        if (
          caught instanceof Error &&
          caught.message === "automatic native permission status unavailable"
        ) {
          setError(
            "Native permission status could not be verified. Automatic check-ins were not enabled; manual check-in remains available."
          );
        } else {
          // report one fully rolled-back attempt
          setError(
            "Automatic check-ins were not enabled by this attempt. Cleanup is complete; manual check-in remains available."
          );
        }
      }
      // refresh without hiding an unavailable aggregate status
      if (mountedRef.current) {
        await refresh().catch(() => setStatusError(true));
      }
    } finally {
      // clear only the operation owned by this invocation
      if (operationRef.current === operation) {
        operationRef.current = null;
      }
      // update only a mounted recovery surface
      if (mountedRef.current) {
        setWorking(false);
      }
    }
  };

  // retry every incomplete rollback boundary
  const retryCleanup = async (): Promise<void> => {
    // preserve the current cleanup plan until convergence
    if (!cleanup) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const subject = currentSubjectRef.current;
      // require one exact durable cleanup owner before token work
      if (!subject || !cleanup.subjectVerified) {
        throw new Error("automatic cleanup owner could not be verified");
      }
      const plugin = await getAutomaticLeaderboardPlugin();
      // require the native cleanup owner
      if (!plugin) {
        throw new Error("automatic cleanup requires the native app");
      }
      const proof = await checkAutomaticEnrollmentCleanup(subject, plugin);
      // require the exact durable owner again before token acquisition
      if (!proof.pending || !proof.valid || !proof.matches) {
        throw new Error("automatic cleanup owner could not be verified");
      }
      await retryAutomaticEnrollmentCleanup(
        cleanup,
        subject,
        // acquire the token only after native purge converges
        getAccessTokenSilently,
        plugin,
        {},
        // recheck the mounted auth owner before marker clear
        () => currentSubjectRef.current
      );
      setCleanup(null);
      setError("Automatic enrollment cleanup completed.");
      // avoid feature-gated preference reads after a closed-rollout cleanup
      if (automaticEnrollmentAdmitted) {
        await refresh();
      }
    } catch (caught) {
      // retain the newest structured cleanup state
      if (isAutomaticEnrollmentCleanupRequiredError(caught)) {
        setCleanup(caught.cleanup);
      }
      setError(
        "Automatic enrollment cleanup is still required. Keep this account signed in and retry."
      );
    } finally {
      setWorking(false);
    }
  };

  // purge locally before confirmed account-wide server revocation
  const disable = async (): Promise<void> => {
    setWorking(true);
    setError(null);
    try {
      await disableAutomaticLeaderboardAccount(
        "local_disable",
        currentSubjectRef.current ?? "",
        // recheck the mounted auth owner at every teardown boundary
        () => currentSubjectRef.current,
        getAccessTokenSilently
      );
      const saved = await getLeaderboardPreferences(
        await getAccessTokenSilently()
      );
      onPreferencesChange(saved);
      const nextStatus = await getAutomaticEnrollmentStatus();
      setStatus(nextStatus);
      setStatusError(nextStatus === null);
    } catch {
      setError(
        "Automatic check-in cleanup did not finish. Retry before signing out or changing accounts."
      );
    } finally {
      setWorking(false);
    }
  };

  // re-enter native permission and settings recovery while degraded
  const reviewPermissions = async (): Promise<void> => {
    setWorking(true);
    setError(null);
    try {
      const plugin = await getAutomaticLeaderboardPlugin();
      // require one eligible native bridge
      if (!plugin) {
        throw new Error("automatic permission recovery unavailable");
      }
      const settings =
        status?.permissionHealth === "authorized" &&
        !isAutomaticEnrollmentHealthy(status)
          ? await openAutomaticEnrollmentSettings(plugin)
          : await requestAutomaticEnrollmentPermissions(plugin);
      const nextStatus = await getAutomaticEnrollmentStatus(plugin);
      setStatus(nextStatus);
      setStatusError(nextStatus === null);
      setError(
        settings.settingsOpened
          ? "Device settings opened. Update location access, return here, then retry status."
          : "Location permission was checked. Retry status after the system change completes."
      );
    } catch {
      setError(
        "Device location settings could not be opened. Manual check-in remains available."
      );
    } finally {
      setWorking(false);
    }
  };

  // omit every automatic surface from web and anonymous sessions
  if (!native || !isAuthenticated || !user?.sub) {
    return null;
  }

  // expose only durable cleanup while rollout admission is closed
  if (cleanup) {
    return (
      <section
        aria-labelledby="automatic-checkins-cleanup-title"
        className="mt-6 rounded-2xl border border-yellow-medium bg-yellow-lightest p-4 text-gray-darkest dark:border-yellow-dark dark:bg-blue-dark dark:text-white"
      >
        <h2 className="font-bold" id="automatic-checkins-cleanup-title">
          Automatic check-in cleanup
        </h2>
        <p
          className="mt-2 text-sm text-stale-dark dark:text-stale-light"
          role="alert"
        >
          {error}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {cleanup.subjectVerified && (
            <button
              className="button button-danger"
              disabled={working}
              // retry only an exact cleanup owner
              onClick={() => retryCleanup()}
              type="button"
            >
              {working ? "Cleaning up…" : "Retry cleanup"}
            </button>
          )}
          <a className="button" href="/leaderboards">
            Use manual check-in
          </a>
        </div>
      </section>
    );
  }

  // prohibit disclosure and enrollment while either rollout gate is closed
  if (!automaticEnrollmentAdmitted) {
    return null;
  }

  // hide disclosure until inert capability is known
  if (capability === undefined) {
    return <p role="status">Checking automatic check-in availability…</p>;
  }

  // report malformed or unavailable native capability truthfully
  if (capability === null) {
    return (
      <p role="alert">
        Automatic check-in capability is unavailable. Retry after reopening the
        app; <a href="/leaderboards">manual check-in remains available</a>.
      </p>
    );
  }

  // keep api-floor devices inert before disclosure or permissions
  if (!capability.supported) {
    return (
      <p role="status">
        Automatic check-ins require Android 10 or newer, or iOS 15 or newer. No
        background permission was requested;{" "}
        <a href="/leaderboards">use manual check-in</a>.
      </p>
    );
  }

  // keep default-off builds inert before disclosure or permissions
  if (!capability.enabled) {
    return (
      <p role="status">
        Automatic check-ins are unavailable in this app build. No background
        permission was requested;{" "}
        <a href="/leaderboards">use manual check-in</a>.
      </p>
    );
  }

  return (
    <section
      aria-labelledby="automatic-checkins-title"
      className="mt-6 rounded-2xl border border-yellow-medium bg-yellow-lightest p-4 text-gray-darkest dark:border-yellow-dark dark:bg-blue-dark dark:text-white"
    >
      <h2 className="font-bold" id="automatic-checkins-title">
        Automatic leaderboard check-ins
      </h2>
      <p className="mt-2 text-sm">
        If you explicitly enable this, Ferry FYI may use precise location and
        terminal-region transitions while the app is not open. It creates
        short-lived encrypted candidates on this device. A candidate becomes
        ineligible at 12 hours; encrypted files are physically removed at the
        next eligible native execution and are never uploaded after expiry.
        Eligible candidates are sent directly to Ferry FYI for verification.
        Submitted coordinates are discarded after verification.
      </p>
      <p className="mt-2 text-sm">
        Automatic check-ins are best effort, not proof that you boarded a ferry.
        Android force-stop, iOS force-quit, permissions, battery policy, or
        connectivity can pause them. Manual check-in always remains available.
      </p>
      <p className="mt-3 text-sm font-semibold" role="status">
        {automaticEnrollmentStatusMessage(status)}
      </p>
      {statusError && (
        <p className="mt-2 text-sm text-stale-dark" role="alert">
          Native status could not be verified. Retry status before changing
          enrollment.
        </p>
      )}
      {!preferences.automaticCheckinsEnabled && (
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            checked={consented}
            className="mt-1"
            disabled={disabled || working}
            // record one explicit disclosure choice
            onChange={(event) => setConsented(event.target.checked)}
            type="checkbox"
          />
          <span>
            I understand the background-location use, short retention, and
            manual fallback.
          </span>
        </label>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {preferences.automaticCheckinsEnabled ? (
          <button
            className="button button-outline"
            disabled={disabled || working}
            // start one controllable teardown
            onClick={() => disable()}
            type="button"
          >
            {working ? "Disabling…" : "Disable automatic check-ins"}
          </button>
        ) : (
          <button
            className="button button-primary"
            disabled={
              !consented ||
              disabled ||
              working ||
              status === null ||
              statusError
            }
            // start one ordered enrollment transaction
            onClick={() => enable()}
            type="button"
          >
            {working
              ? "Checking device settings…"
              : "Enable automatic check-ins"}
          </button>
        )}
        <button
          className="button"
          disabled={disabled || working}
          // reconcile and refetch aggregate status
          onClick={() => {
            setWorking(true);
            setError(null);
            getAutomaticLeaderboardPlugin()
              // reconcile only through an available bridge
              .then(async (plugin) => {
                // request one authoritative native reconciliation
                if (plugin) {
                  await plugin.reconcile();
                }
                await refresh();
              })
              .catch(
                // surface one aggregate refresh failure
                () =>
                  setError("Automatic check-in status could not be refreshed.")
              )
              .finally(
                // release one refresh operation
                () => setWorking(false)
              );
          }}
          type="button"
        >
          Retry status
        </button>
        {status && !isAutomaticEnrollmentHealthy(status) && (
          <button
            className="button button-outline"
            disabled={disabled || working}
            // re-enter reviewed permission recovery
            onClick={() => reviewPermissions()}
            type="button"
          >
            Review device settings
          </button>
        )}
        <a className="button" href="/leaderboards">
          Use manual check-in
        </a>
      </div>
      {error && (
        <p
          className="mt-3 text-sm text-stale-dark dark:text-stale-light"
          role="alert"
        >
          {error}
        </p>
      )}
    </section>
  );
};

// render only exact-subject cleanup outside rollout admission
export const LeaderboardAutomaticCleanupRecovery = (): ReactElement => (
  <LeaderboardAutomaticEnrollment
    disabled
    onPreferencesChange={ignoreCleanupPreferenceUpdate}
    preferences={cleanupRecoveryPreferences}
  />
);
