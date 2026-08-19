import { useAuth0 } from "@auth0/auth0-react";
import { type ReactElement, useEffect, useRef } from "react";

import { isNativeMobileApp } from "~/lib/device";
import {
  checkAutomaticEnrollmentCleanup,
  checkAutomaticEnrollmentIdentity,
  disableAutomaticLeaderboardCheckins,
  getAutomaticEnrollmentCapability,
  getAutomaticLeaderboardPlugin,
  invalidateAutomaticEnrollmentOperations,
} from "~/lib/leaderboardAutomatic";

// coordinate native identity cleanup across auth transitions
export const AutomaticEnrollmentIdentityCoordinator =
  (): ReactElement | null => {
    const { isAuthenticated, isLoading, user } = useAuth0();
    const previousSubjectRef = useRef<string | null | undefined>(undefined);

    // invalidate stale enrollment before an auth identity can change
    useEffect(() => {
      // wait for one authoritative auth decision
      if (isLoading) {
        return;
      }
      const nextSubject = isAuthenticated ? (user?.sub ?? null) : null;
      const previousSubject = previousSubjectRef.current;
      previousSubjectRef.current = nextSubject;

      // preserve repeated observations of the same identity
      if (previousSubject === nextSubject) {
        return;
      }
      let active = true;
      invalidateAutomaticEnrollmentOperations();
      // reconcile one authoritative native ownership observation
      const reconcileIdentity = async (): Promise<void> => {
        // anonymous ownership can never preserve automatic material
        if (!nextSubject) {
          await disableAutomaticLeaderboardCheckins("identity_lost");
          return;
        }
        const plugin = await getAutomaticLeaderboardPlugin();
        // keep ordinary web sessions free of native cleanup work
        if (!plugin && !isNativeMobileApp()) {
          return;
        }
        // keep an unavailable native bridge on the local cleanup boundary
        if (!plugin) {
          await disableAutomaticLeaderboardCheckins("identity_lost", null);
          return;
        }
        // stop one stale observation before capability work
        if (!active) {
          return;
        }
        const capability = await getAutomaticEnrollmentCapability(plugin).catch(
          // treat an unavailable capability as inert
          () => null
        );
        // keep default-off and unsupported native builds inert
        if (!capability?.enabled || !capability.supported || !active) {
          return;
        }
        const cleanupProof = await checkAutomaticEnrollmentCleanup(
          nextSubject,
          plugin
        ).catch(
          // treat unreadable cleanup ownership as pending
          () => ({
            matches: false,
            pending: true,
            schemaVersion: 1 as const,
            valid: false,
          })
        );
        // stop exact or corrupt pending cleanup locally before ownership work
        if (
          active &&
          cleanupProof.pending &&
          (cleanupProof.matches || !cleanupProof.valid)
        ) {
          await disableAutomaticLeaderboardCheckins("identity_lost", plugin);
          return;
        }
        // stop one stale observation before ownership work
        if (!active) {
          return;
        }
        const proof = await checkAutomaticEnrollmentIdentity(
          nextSubject,
          plugin
        ).catch(
          // fail closed on unreadable ownership
          () => null
        );
        // preserve only an exact current-subject device proof
        if (active && proof?.bound && proof.matches) {
          return;
        }
        // prevent an old effect from purging the replacement subject
        if (!active) {
          return;
        }
        await disableAutomaticLeaderboardCheckins("identity_lost", plugin);
      };
      reconcileIdentity().catch(
        // keep the durable native stop visible to diagnostics
        (error) => {
          console.error("Automatic enrollment identity cleanup failed", error);
        }
      );
      // invalidate one subject-bound ownership check
      return () => {
        active = false;
      };
    }, [isAuthenticated, isLoading, user?.sub]);

    return null;
  };
