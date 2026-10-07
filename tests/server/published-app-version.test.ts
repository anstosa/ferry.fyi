import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getPublishedAppVersion,
  PUBLISH_TARGETS,
} from "../../server/scripts/publishedAppVersion";

const REPOSITORY = "anstosa/ferry.fyi";
const TOKEN = "test-token";
const ANDROID_JOB = PUBLISH_TARGETS.android.job;
const ANDROID_STEP = PUBLISH_TARGETS.android.step;
const IOS_JOB = PUBLISH_TARGETS.ios.job;
const IOS_STEP = PUBLISH_TARGETS.ios.step;

// create a completed workflow run with durable version metadata
const run = (
  id: number,
  version: string,
  updatedAt: string,
  platform = "android"
) => ({
  display_title: `Publish apps ${version} (${platform})`,
  head_branch: "production",
  id,
  updated_at: updatedAt,
});

// create an exact store-publication job and step
const job = (
  id: number,
  platform: "android" | "ios",
  completedAt: string,
  conclusion = "success",
  status = "completed"
) => ({
  conclusion: "failure",
  id,
  name: platform === "android" ? ANDROID_JOB : IOS_JOB,
  steps: [
    {
      completed_at: completedAt,
      conclusion,
      name: platform === "android" ? ANDROID_STEP : IOS_STEP,
      status,
    },
  ],
});

// return JSON responses with GitHub collection shapes
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

// route mocked GitHub calls by request path
const githubFetch = (
  runs: unknown[],
  jobs: Record<number, unknown[]>,
  logs: Record<number, string> = {}
) =>
  vi.fn((input: string | URL | Request) => {
    const url = new URL(String(input));
    const runMatch = url.pathname.match(/\/actions\/runs\/(\d+)\/jobs$/u);
    // return jobs for the requested workflow run
    if (runMatch) {
      const values = jobs[Number(runMatch[1])] ?? [];
      return Promise.resolve(
        json({ jobs: values, total_count: values.length })
      );
    }
    const logMatch = url.pathname.match(/\/actions\/jobs\/(\d+)\/logs$/u);
    // return private logs only for the requested job
    if (logMatch) {
      return Promise.resolve(
        new Response(logs[Number(logMatch[1])] ?? "", { status: 200 })
      );
    }
    return Promise.resolve(
      json({ total_count: runs.length, workflow_runs: runs })
    );
  });

describe("published app version", () => {
  // restore mocks after every GitHub API scenario
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // skip newer attempts that never completed a store publication
  it("uses the newest successful publish step instead of the newest run", async () => {
    const fetchImpl = githubFetch(
      [
        run(2, "4.0", "2026-10-02T00:00:00Z"),
        run(1, "3.6", "2026-10-01T00:00:00Z"),
      ],
      {
        1: [job(11, "android", "2026-10-01T00:00:00Z")],
        2: [job(12, "android", "2026-10-02T00:00:00Z", "failure")],
      }
    );

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).resolves.toBe("3.6");
  });

  // fail closed when a known reusable publish job is renamed
  it("rejects a renamed publish job instead of using an older release", async () => {
    const renamedJob = {
      ...job(12, "android", "2026-10-02T00:00:00Z"),
      name: "publish-android / Renamed Android release",
    };
    const fetchImpl = githubFetch(
      [
        run(2, "4.0", "2026-10-02T01:00:00Z"),
        run(1, "3.6", "2026-10-01T01:00:00Z"),
      ],
      {
        1: [job(11, "android", "2026-10-01T00:00:00Z")],
        2: [renamedJob],
      }
    );

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).rejects.toThrow();
  });

  // fail closed when an exact publish job no longer contains its store step
  it("rejects a renamed publish step instead of using an older release", async () => {
    const renamedStep = {
      ...job(12, "android", "2026-10-02T00:00:00Z"),
      steps: [
        {
          completed_at: "2026-10-02T00:00:00Z",
          conclusion: "success",
          name: "Renamed Google Play upload",
          status: "completed",
        },
      ],
    };
    const fetchImpl = githubFetch(
      [
        run(2, "4.0", "2026-10-02T01:00:00Z"),
        run(1, "3.6", "2026-10-01T01:00:00Z"),
      ],
      {
        1: [job(11, "android", "2026-10-01T00:00:00Z")],
        2: [renamedStep],
      }
    );

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).rejects.toThrow();
  });

  // ignore top-level skipped callers that never entered a reusable workflow
  it("ignores an uncomposed skipped publish job", async () => {
    const fetchImpl = githubFetch(
      [
        run(2, "4.0", "2026-10-02T01:00:00Z"),
        run(1, "3.6", "2026-10-01T01:00:00Z"),
      ],
      {
        1: [job(11, "android", "2026-10-01T00:00:00Z")],
        2: [{ id: 12, name: "publish-ios", steps: [] }],
      }
    );

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).resolves.toBe("3.6");
  });

  // count a successful store step even when its enclosing job later fails
  it("accepts a successful publish step inside a failed job", async () => {
    const fetchImpl = githubFetch([run(1, "3.6", "2026-10-01T01:00:00Z")], {
      1: [job(11, "android", "2026-10-01T00:00:00Z")],
    });

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).resolves.toBe("3.6");
  });

  // reject a nominally successful step that has not completed
  it("ignores an incomplete publish step", async () => {
    const fetchImpl = githubFetch([run(1, "3.6", "2026-10-01T01:00:00Z")], {
      1: [job(11, "android", "2026-10-01T00:00:00Z", "success", "in_progress")],
    });

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).rejects.toThrow("missing or ambiguous");
  });

  // select by successful publication time rather than semantic version order
  it("uses chronological publication order instead of the maximum version", async () => {
    const fetchImpl = githubFetch(
      [
        run(1, "9.9", "2026-10-01T01:00:00Z"),
        run(2, "3.6", "2026-10-02T01:00:00Z"),
      ],
      {
        1: [job(11, "android", "2026-10-01T00:00:00Z")],
        2: [job(12, "android", "2026-10-02T00:00:00Z")],
      }
    );

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).resolves.toBe("3.6");
  });

  // defer metadata resolution until actual publish timestamps are compared
  it("ignores unresolved metadata from an older publication step", async () => {
    const oldUnresolved = {
      display_title: "Publish apps",
      head_branch: "production",
      id: 1,
      updated_at: "2026-10-03T00:00:00Z",
    };
    const fetchImpl = githubFetch(
      [oldUnresolved, run(2, "3.6", "2026-10-02T01:00:00Z")],
      {
        1: [job(11, "android", "2026-10-01T00:00:00Z")],
        2: [job(12, "android", "2026-10-02T00:00:00Z")],
      }
    );

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).resolves.toBe("3.6");
    // avoid obsolete legacy log retrieval
    expect(
      fetchImpl.mock.calls.every(([input]) => !String(input).endsWith("/logs"))
    ).toBe(true);
  });

  // recover the current legacy workflow version only from its exact job log
  it("reads one repeated VERSION_NAME from a legacy publish job", async () => {
    const legacyRun = {
      display_title: "Publish apps",
      head_branch: "production",
      id: 33646229751,
      updated_at: "2026-09-02T15:13:00Z",
    };
    const fetchImpl = githubFetch(
      [legacyRun],
      {
        33646229751: [job(100301561931, "android", "2026-09-02T15:12:48Z")],
      },
      {
        100301561931:
          "2026-09-02T15:07:17Z   VERSION_NAME: 3.6\n" +
          "2026-09-02T15:07:18Z REQUESTED_VERSION_NAME: 4.0\n" +
          "2026-09-02T15:07:19Z   VERSION_NAME: 3.6\n",
      }
    );

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).resolves.toBe("3.6");
  });

  // paginate workflow runs and all job attempts at one hundred records
  it("paginates workflow runs and jobs", async () => {
    const failedRuns = Array.from({ length: 100 }, (_, index) =>
      run(index + 1, "4.0", "2026-10-03T00:00:00Z")
    );
    const unrelatedJobs = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      name: "unrelated",
      steps: [],
    }));
    const fetchImpl = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page"));
      // paginate workflow runs independently
      if (url.pathname.endsWith("/runs")) {
        return Promise.resolve(
          json({
            total_count: 101,
            workflow_runs:
              page === 1
                ? failedRuns
                : [run(101, "3.6", "2026-10-02T00:00:00Z")],
          })
        );
      }
      const runMatch = url.pathname.match(/\/actions\/runs\/(\d+)\/jobs$/u);
      // reject unexpected pagination endpoints
      if (!runMatch) {
        return Promise.resolve(json({}, 404));
      }
      const runId = Number(runMatch[1]);
      // return empty jobs for unrelated failed runs
      if (runId !== 101) {
        return Promise.resolve(json({ jobs: [], total_count: 0 }));
      }
      return Promise.resolve(
        json({
          jobs:
            page === 1
              ? unrelatedJobs
              : [job(1001, "android", "2026-10-01T00:00:00Z")],
          total_count: 101,
        })
      );
    });

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).resolves.toBe("3.6");
    // prove at least one collection reached its second page
    expect(
      fetchImpl.mock.calls.some(([input]) => String(input).includes("page=2"))
    ).toBe(true);
  });

  // derive tagged Android and iOS releases without downloading logs
  it.each([
    ["android", "android-v3.6"],
    ["ios", "ios-v3.6"],
  ] as const)("accepts a canonical %s release tag", async (platform, tag) => {
    const taggedRun = {
      display_title: "tag publication",
      head_branch: tag,
      id: 1,
      updated_at: "2026-10-01T01:00:00Z",
    };
    const fetchImpl = githubFetch([taggedRun], {
      1: [job(11, platform, "2026-10-01T00:00:00Z")],
    });

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).resolves.toBe("3.6");
    // keep durable tag metadata off the legacy log path
    expect(
      fetchImpl.mock.calls.every(([input]) => !String(input).endsWith("/logs"))
    ).toBe(true);
  });

  // preserve tag metadata in the durable custom workflow title
  it.each(["android", "ios"] as const)(
    "accepts a canonical %s tag run title",
    async (platform) => {
      const taggedRun = {
        display_title: `Publish apps ${platform}-v3.6 (tag)`,
        head_branch: "production",
        id: 1,
        updated_at: "2026-10-01T01:00:00Z",
      };
      const fetchImpl = githubFetch([taggedRun], {
        1: [job(11, platform, "2026-10-01T00:00:00Z")],
      });

      await expect(
        getPublishedAppVersion({
          fetchImpl,
          repository: REPOSITORY,
          token: TOKEN,
        })
      ).resolves.toBe("3.6");
    }
  );

  // reject conflicting durable title and tag version evidence
  it("rejects conflicting tag versions", async () => {
    const taggedRun = {
      display_title: "Publish apps android-v3.6 (tag)",
      head_branch: "android-v3.5",
      id: 1,
      updated_at: "2026-10-01T01:00:00Z",
    };
    const fetchImpl = githubFetch([taggedRun], {
      1: [job(11, "android", "2026-10-01T00:00:00Z")],
    });

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).rejects.toThrow("conflicting version metadata");
  });

  // fail rather than using an older publication when the newest lacks a version
  it("fails closed when the latest successful publication is unresolved", async () => {
    const malformed = {
      ...run(2, "3.6", "2026-10-02T01:00:00Z"),
      display_title: "Publish apps 3.6.0 (android)",
    };
    const fetchImpl = githubFetch(
      [malformed, run(1, "3.5", "2026-10-01T01:00:00Z")],
      {
        1: [job(11, "android", "2026-10-01T00:00:00Z")],
        2: [job(12, "android", "2026-10-02T00:00:00Z")],
      }
    );

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).rejects.toThrow("no canonical version metadata");
  });

  // reject missing and conflicting legacy version evidence
  it.each([
    ["missing", "unrelated output"],
    ["ambiguous", "VERSION_NAME: 3.5\nVERSION_NAME: 3.6"],
    ["unsupported", "VERSION_NAME: 3.6.0"],
    ["prerelease", "VERSION_NAME: 3.6-beta"],
    ["build metadata", "VERSION_NAME: 3.6+source"],
    ["trailing characters", "VERSION_NAME: 3.6x"],
  ])("rejects %s legacy log evidence", async (_case, log) => {
    const legacyRun = {
      display_title: "Publish apps",
      head_branch: "production",
      id: 1,
      updated_at: "2026-10-01T01:00:00Z",
    };
    const fetchImpl = githubFetch(
      [legacyRun],
      { 1: [job(11, "android", "2026-10-01T00:00:00Z")] },
      { 11: log }
    );

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).rejects.toThrow("missing or ambiguous VERSION_NAME");
  });

  // preserve run updates as an upper bound on successful step completion
  it("rejects a publish step completed after its run update", async () => {
    const fetchImpl = githubFetch([run(1, "3.6", "2026-10-01T00:00:00Z")], {
      1: [job(11, "android", "2026-10-01T00:00:01Z")],
    });

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).rejects.toThrow("after its workflow run update");
  });

  // reject API errors without including the private response body
  it("fails closed on GitHub API errors", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(json({ message: `secret ${TOKEN}` }, 403))
    );

    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).rejects.toThrow("status 403");
    await expect(
      getPublishedAppVersion({
        fetchImpl,
        repository: REPOSITORY,
        token: TOKEN,
      })
    ).rejects.not.toThrow(TOKEN);
  });
});
