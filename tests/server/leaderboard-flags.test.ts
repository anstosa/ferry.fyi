import { beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({
  rows: new Map<
    string,
    { enabled: boolean; killSwitch: boolean; name: string }
  >(),
  findOrCreate: vi.fn(),
}));
const allowlist = vi.hoisted(() => ({
  rows: new Set<string>(),
  bulkCreate: vi.fn(),
  destroy: vi.fn(),
  findAll: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock("~/models/FeatureFlag", () => ({ FeatureFlag: flags }));
vi.mock("~/models/FeatureFlagAllowlist", () => ({
  FeatureFlagAllowlist: allowlist,
}));

import {
  getFeatureFlagsForSubject,
  isFeatureEnabledForSubject,
  isPublicFeatureEnabled,
  setFeatureFlagState,
} from "../../server/lib/leaderboardFlags";

const key = (name: string, subject: string): string => `${name}:${subject}`;

beforeEach(() => {
  flags.rows.clear();
  allowlist.rows.clear();
  flags.findOrCreate.mockImplementation(async ({ defaults, where }) => {
    let row = flags.rows.get(where.name);
    if (!row) {
      row = { ...defaults };
      flags.rows.set(where.name, row);
    }
    return [
      {
        ...row,
        update: async (changes: Partial<typeof row>) => {
          Object.assign(row, changes);
        },
      },
    ];
  });
  allowlist.findOne.mockImplementation(async ({ where }) =>
    allowlist.rows.has(key(where.name, where.subject))
      ? { name: where.name, subject: where.subject }
      : null
  );
  allowlist.findAll.mockImplementation(async ({ where }) =>
    [...allowlist.rows]
      .filter((entry) => entry.startsWith(`${where.name}:`))
      .map((entry) => ({ subject: entry.slice(where.name.length + 1) }))
  );
  allowlist.destroy.mockImplementation(async ({ where }) => {
    for (const entry of [...allowlist.rows]) {
      if (entry.startsWith(`${where.name}:`)) {
        allowlist.rows.delete(entry);
      }
    }
  });
  allowlist.bulkCreate.mockImplementation(async (rows) => {
    rows.forEach(({ name, subject }: { name: string; subject: string }) =>
      allowlist.rows.add(key(name, subject))
    );
  });
});

describe("leaderboard feature evaluation", () => {
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
});
