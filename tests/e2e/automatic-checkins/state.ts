import type {
  AutomaticEnrollmentCapabilityV1,
  AutomaticEnrollmentPermissionResultV1,
  AutomaticEnrollmentStatusV1,
  LeaderboardPreferences,
} from "shared/contracts/leaderboards";

// define one public browser fixture state
export interface AutomaticBrowserFixtureState {
  calls: string[];
  capability: AutomaticEnrollmentCapabilityV1;
  featureEnabled: boolean;
  foregroundPermission: AutomaticEnrollmentPermissionResultV1;
  preferences: LeaderboardPreferences;
  status: AutomaticEnrollmentStatusV1;
}

// retain one detail-free invalidation callback
type FixtureListener = () => void;

// provide one complete healthy aggregate
const healthyStatus: AutomaticEnrollmentStatusV1 = {
  capabilityVersion: 1,
  configGeneration: 7,
  credentialExpiryBucket: "seven_days_or_more",
  lastOutcome: null,
  monitorHealth: "healthy",
  pendingCandidateCount: 0,
  permissionHealth: "authorized",
  platform: "android",
  schemaVersion: 1,
  serverPolicyGeneration: 11,
};

// create one scenario-specific browser fixture
const createState = (): AutomaticBrowserFixtureState => {
  const scenario = new URLSearchParams(window.location.search).get("scenario");
  const state: AutomaticBrowserFixtureState = {
    calls: [],
    capability: {
      androidSdkInt: 36,
      capabilityVersion: 1,
      enabled: scenario !== "disabled",
      platform: "android",
      schemaVersion: 1,
      supported: scenario !== "unsupported",
    },
    featureEnabled: scenario !== "feature-off",
    foregroundPermission: {
      permissionHealth: scenario === "denied" ? "denied" : "authorized",
      schemaVersion: 1,
      settingsOpened: false,
    },
    preferences: {
      automaticCheckinsEnabled:
        scenario === "enabled" || scenario === "degraded",
      displayName: "Fixture rider",
      notificationsEnabled: true,
      optedOut: false,
      useFullName: false,
      verboseNotificationsEnabled: false,
    },
    status: {
      ...healthyStatus,
      ...(scenario === "denied"
        ? {
            monitorHealth: "stopped" as const,
            permissionHealth: "denied" as const,
          }
        : {}),
      ...(scenario === "degraded"
        ? { monitorHealth: "registration_failed" as const }
        : {}),
    },
  };
  // preserve an internally consistent unsupported projection
  if (scenario === "unsupported") {
    state.capability.androidSdkInt = 28;
    state.capability.enabled = false;
  }
  return state;
};

// expose one mutable production-component fixture
export const automaticFixtureState = createState();
// retain each detail-free fixture listener
export const automaticFixtureListeners = new Set<FixtureListener>();
// start without an attached react render owner
let renderFixture = (): void => undefined;

// bind one react rerender owner
export const bindAutomaticFixtureRender = (render: () => void): void => {
  renderFixture = render;
};

// merge one public test-state update
const setAutomaticFixtureState = (
  update: Partial<AutomaticBrowserFixtureState>
): void => {
  Object.assign(automaticFixtureState, update);
  renderFixture();
};

// emit one payload-free credited invalidation
const emitAutomaticFixtureChange = (): void => {
  automaticFixtureState.calls.push("native:event");
  // notify each registered production listener
  for (const listener of automaticFixtureListeners) {
    listener();
  }
};

declare global {
  interface Window {
    automaticCheckinFixture: {
      emitChange: () => void;
      read: () => AutomaticBrowserFixtureState;
      set: (update: Partial<AutomaticBrowserFixtureState>) => void;
    };
  }
}

window.automaticCheckinFixture = {
  emitChange: emitAutomaticFixtureChange,
  // return one clone without mutable bridge ownership
  read: () => structuredClone(automaticFixtureState),
  set: setAutomaticFixtureState,
};
