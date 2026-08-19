import type { AutomaticLeaderboardCheckinsPluginV1 } from "../../../client/lib/leaderboardAutomatic";

import { automaticFixtureListeners, automaticFixtureState } from "./state";

// retain one device-only cleanup owner fixture
let cleanupSubject: string | null = null;

// implement the exact production plugin contract
const plugin: AutomaticLeaderboardCheckinsPluginV1 = {
  // register one detail-free invalidation listener
  addListener: async (_eventName, listener) => {
    automaticFixtureListeners.add(listener);
    return {
      // remove one registered listener
      remove: async () => {
        automaticFixtureListeners.delete(listener);
      },
    };
  },
  // bind one fixture credential owner without exposing detail
  bindIdentity: async () => ({ bound: true, schemaVersion: 1 }),
  // confirm one fixture credential owner without exposing detail
  checkIdentity: async () => ({
    bound: true,
    matches: true,
    schemaVersion: 1,
  }),
  // check one fixture cleanup obligation
  checkEnrollmentCleanup: async ({ subject }) => ({
    matches: cleanupSubject === subject,
    pending: cleanupSubject !== null,
    schemaVersion: 1,
    valid: true,
  }),
  // clear only one matching fixture cleanup obligation
  clearEnrollmentCleanup: async ({ subject }) => {
    const cleared = cleanupSubject === null || cleanupSubject === subject;
    // remove only one matching marker
    if (cleared) {
      cleanupSubject = null;
    }
    return { cleared, schemaVersion: 1 };
  },
  // purge one native identity
  disableAndPurge: async () => {
    automaticFixtureState.calls.push("native:purge");
    automaticFixtureState.status = {
      ...automaticFixtureState.status,
      configGeneration: null,
      monitorHealth: "stopped",
      pendingCandidateCount: 0,
    };
    return { purged: true };
  },
  // return one inert capability projection
  getCapability: async () => {
    automaticFixtureState.calls.push("native:capability");
    return structuredClone(automaticFixtureState.capability);
  },
  // return one installation bootstrap
  getEnrollmentBootstrap: async () => ({
    androidSdkInt: 36,
    capabilityVersion: 1,
    enabled: true,
    installationNonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    manualFallbackAvailable: true,
    platform: "android",
    schemaVersion: 1,
    supported: true,
  }),
  // return one aggregate-only native status
  getStatus: async () => {
    automaticFixtureState.calls.push("native:status");
    return structuredClone(automaticFixtureState.status);
  },
  // confirm one fixture credential install
  installCredential: async () => ({ installed: true }),
  // open one reviewed settings boundary
  openAutomaticCheckinSettings: async () => {
    automaticFixtureState.calls.push("native:settings");
    return { schemaVersion: 1, settingsOpened: true };
  },
  // reconcile one aggregate fixture
  reconcile: async () => {
    automaticFixtureState.calls.push("native:reconcile");
    return { outcome: "applied" };
  },
  // request one background permission result
  requestBackgroundLocationPermission: async () => {
    automaticFixtureState.calls.push("native:background-permission");
    return structuredClone(automaticFixtureState.foregroundPermission);
  },
  // request one foreground permission result
  requestForegroundLocationPermission: async () => {
    automaticFixtureState.calls.push("native:foreground-permission");
    return structuredClone(automaticFixtureState.foregroundPermission);
  },
  // stage one fixture cleanup obligation
  stageEnrollmentCleanup: async ({ subject }) => {
    cleanupSubject = subject;
    return { schemaVersion: 1, staged: true };
  },
};

// expose the minimal capacitor runtime used by production client modules
export const Capacitor = {
  // report one native fixture platform
  isNativePlatform: (): boolean => true,
};

// expose one deterministic http fixture
export const CapacitorHttp = {
  // execute one deterministic fixture api request
  request: async (input: {
    data?: Record<string, unknown>;
    method: string;
    url: string;
  }) => {
    const path = new URL(input.url, window.location.origin).pathname;
    automaticFixtureState.calls.push(`api:${input.method}:${path}`);
    // return current preferences
    if (input.method === "GET" && path.endsWith("/leaderboards/preferences")) {
      return {
        data: structuredClone(automaticFixtureState.preferences),
        status: 200,
      };
    }
    // commit one account-wide disable
    if (
      input.method === "POST" &&
      path.endsWith("/leaderboards/automatic/disable")
    ) {
      // reject a fixture token-subject replacement before mutation
      if (input.data?.expectedSubject !== "auth0|automatic-browser-fixture") {
        return {
          data: { error: "automatic_cleanup_subject_changed" },
          status: 409,
        };
      }
      automaticFixtureState.preferences = {
        ...automaticFixtureState.preferences,
        automaticCheckinsEnabled: false,
      };
      return {
        data: { disabled: true, schemaVersion: 1, serverPolicyGeneration: 12 },
        status: 200,
      };
    }
    // persist one generic preference update
    if (input.method === "PUT" && path.endsWith("/leaderboards/preferences")) {
      automaticFixtureState.preferences = {
        ...automaticFixtureState.preferences,
        ...input.data,
      };
      return {
        data: structuredClone(automaticFixtureState.preferences),
        status: 200,
      };
    }
    return { data: { error: "fixture_not_found" }, status: 404 };
  },
};

// return the exact production plugin fixture
export const registerPlugin = <T>(): T => plugin as T;

window.Capacitor = Capacitor;
