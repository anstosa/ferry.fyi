import { beforeEach, describe, expect, it, vi } from "vitest";

// hoist feature flag seams
const flags = vi.hoisted(() => ({
  rows: new Map<
    string,
    {
      enabled: boolean;
      killSwitch: boolean;
      name: string;
      serverPolicyGeneration: number;
      update?: ReturnType<typeof vi.fn>;
    }
  >(),
  findOrCreate: vi.fn(),
}));
// hoist allowlist seams
const allowlist = vi.hoisted(() => ({
  rows: new Set<string>(),
  bulkCreate: vi.fn(),
  destroy: vi.fn(),
  findAll: vi.fn(),
  findOne: vi.fn(),
}));
// hoist policy seams
const policy = vi.hoisted(() => ({
  advanceServerPolicyGeneration: vi.fn(),
  withLeaderboardAutomaticPolicyTransaction: vi.fn(),
}));

// bind feature flag seams
vi.mock("~/models/FeatureFlag", () => ({ FeatureFlag: flags }));
// bind allowlist seams
vi.mock("~/models/FeatureFlagAllowlist", () => ({
  FeatureFlagAllowlist: allowlist,
}));
// bind policy seams
vi.mock("~/lib/leaderboardAutomaticPolicy", () => ({
  advanceServerPolicyGeneration: policy.advanceServerPolicyGeneration,
  AUTOMATIC_LEADERBOARD_CHECKINS_FLAG: "automaticLeaderboardCheckins",
  LEADERBOARDS_FLAG: "leaderboards",
  withLeaderboardAutomaticPolicyTransaction:
    policy.withLeaderboardAutomaticPolicyTransaction,
}));

import {
  getFeatureFlagsForSubject,
  getLeaderboardFlags,
  isFeatureEnabledForSubject,
  isPublicFeatureEnabled,
  setFeatureFlagState,
  updateFeatureFlagState,
} from "../../server/lib/leaderboardFlags";

// build one allowlist key
const key = (name: string, subject: string): string => `${name}:${subject}`;

// reset feature policy seams
beforeEach(() => {
  flags.rows.clear();
  allowlist.rows.clear();
  // emulate feature row creation
  flags.findOrCreate.mockImplementation(({ defaults, where }) => {
    let row = flags.rows.get(where.name);
    // create a missing feature row
    if (!row) {
      row = { serverPolicyGeneration: 0, ...defaults };
      flags.rows.set(where.name, row);
    }
    // mutate a feature row
    row.update = vi.fn((changes: Partial<typeof row>) => {
      Object.assign(row, changes);
    });
    return [
      {
        ...row,
        update: row.update,
      },
    ];
  });
  // execute policy callbacks inline
  policy.withLeaderboardAutomaticPolicyTransaction.mockImplementation(
    async (_options, callback) => {
      // resolve one locked feature row
      const getRow = (name: string) => {
        let row = flags.rows.get(name);
        // create a missing locked row
        if (!row) {
          row = {
            enabled: false,
            killSwitch: false,
            name,
            serverPolicyGeneration: 0,
          };
          flags.rows.set(name, row);
        }
        // mutate a locked row
        row.update = vi.fn((changes: Partial<typeof row>) => {
          Object.assign(row, changes);
        });
        return row;
      };
      // invoke the transaction callback
      return await callback({
        automaticFlag: getRow("automaticLeaderboardCheckins"),
        parentFlag: getRow("leaderboards"),
        transaction: { id: "policy" },
      });
    }
  );
  // advance the canonical generation
  policy.advanceServerPolicyGeneration.mockImplementation((locked) => {
    locked.automaticFlag.serverPolicyGeneration += 1;
    return locked.automaticFlag.serverPolicyGeneration;
  });
  // find one subject admission
  allowlist.findOne.mockImplementation(({ where }) =>
    allowlist.rows.has(key(where.name, where.subject))
      ? { name: where.name, subject: where.subject }
      : null
  );
  // list one feature allowlist
  allowlist.findAll.mockImplementation(({ where }) =>
    [...allowlist.rows]
      // select this feature's subjects
      .filter((entry) => entry.startsWith(`${where.name}:`))
      // project stored subject values
      .map((entry) => ({ subject: entry.slice(where.name.length + 1) }))
  );
  // remove one feature allowlist
  allowlist.destroy.mockImplementation(({ where }) => {
    // visit each stored admission
    for (const entry of [...allowlist.rows]) {
      // remove matching admissions
      if (entry.startsWith(`${where.name}:`)) {
        allowlist.rows.delete(entry);
      }
    }
  });
  // insert replacement admissions
  allowlist.bulkCreate.mockImplementation((rows) => {
    // store each admission
    rows.forEach(({ name, subject }: { name: string; subject: string }) =>
      allowlist.rows.add(key(name, subject))
    );
  });
});

// cover leaderboard feature evaluation
describe("leaderboard feature evaluation", () => {
  // prove flag precedence
  it("uses kill switch, global enablement, then subject allowlist precedence", async () => {
    await setFeatureFlagState("leaderboards", {
      enabled: false,
      killSwitch: false,
      subjects: ["auth0|tester"],
    });

    await expect(isPublicFeatureEnabled("leaderboards")).resolves.toBe(false);
    await expect(
      isFeatureEnabledForSubject("leaderboards", "auth0|tester")
    ).resolves.toBe(true);
    await expect(
      isFeatureEnabledForSubject("leaderboards", "auth0|other")
    ).resolves.toBe(false);

    await setFeatureFlagState("leaderboards", {
      enabled: true,
      killSwitch: false,
      subjects: [],
    });
    await expect(isPublicFeatureEnabled("leaderboards")).resolves.toBe(true);
    await expect(
      isFeatureEnabledForSubject("leaderboards", "auth0|other")
    ).resolves.toBe(true);

    await setFeatureFlagState("leaderboards", {
      enabled: true,
      killSwitch: true,
      subjects: ["auth0|tester"],
    });
    await expect(isPublicFeatureEnabled("leaderboards")).resolves.toBe(false);
    await expect(
      isFeatureEnabledForSubject("leaderboards", "auth0|tester")
    ).resolves.toBe(false);
  });

  // prove authenticated delivery
  it("returns only a subject-aware authenticated decision", async () => {
    await setFeatureFlagState("leaderboards", {
      enabled: false,
      killSwitch: false,
      subjects: ["auth0|tester"],
    });
    await expect(getFeatureFlagsForSubject("auth0|tester")).resolves.toEqual({
      automaticLeaderboardCheckinsEnabled: false,
      leaderboardsEnabled: true,
    });
  });

  // prove parent gating and public privacy
  it("parent-gates subject automatic access without leaking it anonymously", async () => {
    await setFeatureFlagState("leaderboards", {
      enabled: false,
      killSwitch: false,
      subjects: ["auth0|tester"],
    });
    await setFeatureFlagState("automaticLeaderboardCheckins", {
      enabled: false,
      killSwitch: false,
      subjects: ["auth0|tester"],
    });

    await expect(getFeatureFlagsForSubject("auth0|tester")).resolves.toEqual({
      automaticLeaderboardCheckinsEnabled: true,
      leaderboardsEnabled: true,
    });
    await expect(getLeaderboardFlags()).resolves.toEqual({
      automaticLeaderboardCheckinsEnabled: false,
      leaderboardsEnabled: false,
    });
  });

  // prove transaction-local merging
  it("merges partial writes only after policy locks are held", async () => {
    await setFeatureFlagState("automaticLeaderboardCheckins", {
      enabled: true,
      killSwitch: false,
      subjects: ["auth0|pilot"],
    });
    flags.findOrCreate.mockClear();

    await expect(
      updateFeatureFlagState("automaticLeaderboardCheckins", {
        killSwitch: true,
      })
    ).resolves.toEqual({
      enabled: true,
      killSwitch: true,
      name: "automaticLeaderboardCheckins",
      subjects: ["auth0|pilot"],
    });
    expect(policy.withLeaderboardAutomaticPolicyTransaction).toHaveBeenCalled();
    expect(flags.findOrCreate).not.toHaveBeenCalled();
  });

  // prove no-op generation stability
  it("does not advance policy generation for a no-op write", async () => {
    await setFeatureFlagState("automaticLeaderboardCheckins", {
      enabled: false,
      killSwitch: false,
      subjects: [],
    });
    policy.advanceServerPolicyGeneration.mockClear();

    await updateFeatureFlagState("automaticLeaderboardCheckins", {
      enabled: false,
    });

    expect(policy.advanceServerPolicyGeneration).not.toHaveBeenCalled();
  });
});
