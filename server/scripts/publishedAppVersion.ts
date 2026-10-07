const API_VERSION = "2026-03-10";
const WORKFLOW_FILE = "publish-apps.yml";
const PAGE_SIZE = 100;
const VERSION_PATTERN = "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)";
const VERSION_EXACT_PATTERN = new RegExp(`^${VERSION_PATTERN}$`, "u");
const RUN_TITLE_PATTERN = new RegExp(
  `^Publish apps (${VERSION_PATTERN}) \\((android|ios|both)\\)$`,
  "u"
);
const TAG_RUN_TITLE_PATTERN = new RegExp(
  `^Publish apps (android|ios)-v(${VERSION_PATTERN}) \\(tag\\)$`,
  "u"
);
const TAG_PATTERN = new RegExp(`^(android|ios)-v(${VERSION_PATTERN})$`, "u");
const LOG_VERSION_PATTERN = new RegExp(
  `(?:^|\\s)VERSION_NAME:\\s*(${VERSION_PATTERN})(?=\\s|$)`,
  "gu"
);

// define exact github actions publication protocol names
export const PUBLISH_TARGETS = {
  android: {
    job: "publish-android / Build and publish internal Android release",
    step: "Publish to Google Play internal testing",
  },
  ios: {
    job: "publish-ios / Build and publish TestFlight release",
    step: "Publish to TestFlight",
  },
} as const;

type Platform = keyof typeof PUBLISH_TARGETS;

interface WorkflowRun {
  displayTitle: string;
  headBranch: string | null;
  id: number;
  updatedAt: number;
}

interface SuccessfulPublish {
  completedAt: number;
  jobId: number;
  platform: Platform;
  run: WorkflowRun;
}

interface PublishedVersionOptions {
  fetchImpl?: typeof fetch;
  repository: string;
  token: string;
}

interface PageResult {
  items: unknown[];
  totalCount: number;
}

// narrow unknown JSON objects before reading GitHub fields
const asRecord = (value: unknown, context: string): Record<string, unknown> => {
  // reject non-object api values
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`GitHub returned malformed ${context}`);
  }
  return value as Record<string, unknown>;
};

// parse GitHub timestamps used to order completed publications
const parseTimestamp = (value: unknown, context: string): number => {
  // require github timestamp strings
  if (typeof value !== "string") {
    throw new Error(`GitHub returned malformed ${context}`);
  }
  const timestamp = Date.parse(value);
  // reject invalid github timestamps
  if (!Number.isFinite(timestamp)) {
    throw new Error(`GitHub returned malformed ${context}`);
  }
  return timestamp;
};

// require numeric identifiers before interpolating API paths
const parseId = (value: unknown, context: string): number => {
  // require positive safe github identifiers
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`GitHub returned malformed ${context}`);
  }
  return Number(value);
};

// perform an authenticated GitHub request without exposing response bodies
const githubRequest = async (
  url: string,
  token: string,
  fetchImpl: typeof fetch
): Promise<Response> => {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
    },
  });
  // reject every non-success api response
  if (!response.ok) {
    throw new Error(`GitHub request failed with status ${response.status}`);
  }
  return response;
};

// validate a paginated GitHub collection response
const parsePage = (value: unknown, key: string): PageResult => {
  const record = asRecord(value, `${key} page`);
  const items = record[key];
  const totalCount = record.total_count;
  // require a complete github collection shape
  if (
    !Array.isArray(items) ||
    !Number.isSafeInteger(totalCount) ||
    Number(totalCount) < 0
  ) {
    throw new Error(`GitHub returned malformed ${key} page`);
  }
  return { items, totalCount: Number(totalCount) };
};

// exhaust a collection so later sorting is independent of API page order
const fetchPages = async (
  baseUrl: string,
  key: string,
  token: string,
  fetchImpl: typeof fetch
): Promise<unknown[]> => {
  const items: unknown[] = [];
  let page = 1;
  let totalCount = 0;
  // fetch every reported collection page
  do {
    const separator = baseUrl.includes("?") ? "&" : "?";
    const response = await githubRequest(
      `${baseUrl}${separator}per_page=${PAGE_SIZE}&page=${page}`,
      token,
      fetchImpl
    );
    let value: unknown;
    // parse github json without exposing response bodies
    try {
      value = await response.json();
    } catch {
      throw new Error(`GitHub returned invalid JSON for ${key}`);
    }
    const result = parsePage(value, key);
    items.push(...result.items);
    ({ totalCount } = result);
    // stop malformed pagination from looping forever
    if (result.items.length === 0 && items.length < totalCount) {
      throw new Error(`GitHub returned an incomplete ${key} collection`);
    }
    page += 1;
    // continue until github's reported total is collected
  } while (items.length < totalCount);
  return items;
};

// validate workflow metadata used as the publication-time upper bound
const parseRun = (value: unknown): WorkflowRun => {
  const run = asRecord(value, "workflow run");
  // require durable title and branch metadata
  if (
    typeof run.display_title !== "string" ||
    (typeof run.head_branch !== "string" && run.head_branch !== null)
  ) {
    throw new Error("GitHub returned malformed workflow run");
  }
  return {
    displayTitle: run.display_title,
    headBranch: run.head_branch,
    id: parseId(run.id, "workflow run id"),
    updatedAt: parseTimestamp(run.updated_at, "workflow run timestamp"),
  };
};

// extract successful store-upload steps from every attempt of a workflow run
const findSuccessfulPublishes = async (
  run: WorkflowRun,
  apiBase: string,
  token: string,
  fetchImpl: typeof fetch
): Promise<SuccessfulPublish[]> => {
  const jobs = await fetchPages(
    `${apiBase}/actions/runs/${run.id}/jobs?filter=all`,
    "jobs",
    token,
    fetchImpl
  );
  const publishes: SuccessfulPublish[] = [];
  // inspect every job attempt in the completed run
  for (const value of jobs) {
    const job = asRecord(value, "workflow job");
    // require names before protocol matching
    if (typeof job.name !== "string") {
      throw new Error("GitHub returned malformed workflow job");
    }
    // retain the narrowed job name inside protocol callbacks
    const jobName = job.name;
    // find an exact configured publication job
    const targetEntry = Object.entries(PUBLISH_TARGETS).find(
      ([, target]) => target.job === jobName
    );
    // detect renamed jobs from known reusable workflow callers
    const hasKnownCallerPrefix = Object.values(PUBLISH_TARGETS).some(
      (target) => {
        const [callerPrefix] = target.job.split(" / ");
        return jobName.startsWith(`${callerPrefix} / `);
      }
    );
    // fail closed when the publication protocol job name drifts
    if (!targetEntry && hasKnownCallerPrefix) {
      throw new Error("GitHub returned an unknown composed publish job");
    }
    // skip jobs outside the native publication protocol
    if (!targetEntry) {
      continue;
    }
    // require steps from an exact reusable publication job
    if (!Array.isArray(job.steps)) {
      throw new Error("GitHub returned malformed publish job");
    }
    const [platform, target] = targetEntry as [
      Platform,
      (typeof PUBLISH_TARGETS)[Platform],
    ];
    const jobId = parseId(job.id, "publish job id");
    let hasExpectedStep = false;
    // inspect every attempt step for the exact store publication boundary
    for (const stepValue of job.steps) {
      const step = asRecord(stepValue, "workflow step");
      // record the expected step even when it failed or was skipped
      if (step.name === target.step) {
        hasExpectedStep = true;
      }
      // count only completed successful store publications
      if (
        step.name !== target.step ||
        step.status !== "completed" ||
        step.conclusion !== "success"
      ) {
        continue;
      }
      const completedAt = parseTimestamp(
        step.completed_at,
        "publish step timestamp"
      );
      // preserve the workflow update upper bound
      if (completedAt > run.updatedAt) {
        throw new Error("Publish step completed after its workflow run update");
      }
      publishes.push({
        completedAt,
        jobId,
        platform,
        run,
      });
    }
    // reject workflow drift instead of falling back to an older release
    if (!hasExpectedStep) {
      throw new Error("GitHub publish job omitted its expected store step");
    }
  }
  // resolve the newest step first so obsolete attempts cannot block it
  return publishes.sort((left, right) => right.completedAt - left.completedAt);
};

// read one canonical version from an exact legacy publish job log
const getLegacyJobVersion = async (
  publish: SuccessfulPublish,
  apiBase: string,
  token: string,
  fetchImpl: typeof fetch
): Promise<string> => {
  const response = await githubRequest(
    `${apiBase}/actions/jobs/${publish.jobId}/logs`,
    token,
    fetchImpl
  );
  const logs = await response.text();
  const versions = new Set<string>();
  // collect distinct canonical legacy values
  for (const match of logs.matchAll(LOG_VERSION_PATTERN)) {
    versions.add(match[1]);
  }
  // require one unambiguous legacy version
  if (versions.size !== 1) {
    throw new Error("Legacy publish job has missing or ambiguous VERSION_NAME");
  }
  return [...versions][0];
};

// bind a successful store upload to durable run metadata or legacy job logs
const resolvePublishVersion = async (
  publish: SuccessfulPublish,
  apiBase: string,
  token: string,
  fetchImpl: typeof fetch
): Promise<string> => {
  const titleMatch = publish.run.displayTitle.match(RUN_TITLE_PATTERN);
  const tagTitleMatch = publish.run.displayTitle.match(TAG_RUN_TITLE_PATTERN);
  const tagMatch = publish.run.headBranch?.match(TAG_PATTERN) ?? null;
  // validate dispatch title platform metadata
  if (titleMatch) {
    const titlePlatform = titleMatch[2];
    // require the title to include the published platform
    if (titlePlatform !== "both" && titlePlatform !== publish.platform) {
      throw new Error("Published app run title has a mismatched platform");
    }
  }
  // validate tag branch platform metadata
  if (tagMatch && tagMatch[1] !== publish.platform) {
    throw new Error("Published app tag has a mismatched platform");
  }
  // validate tag title platform metadata
  if (tagTitleMatch && tagTitleMatch[1] !== publish.platform) {
    throw new Error("Published app tag title has a mismatched platform");
  }
  // discard absent metadata sources before comparison
  const versions = new Set(
    [titleMatch?.[1], tagTitleMatch?.[2], tagMatch?.[2]].filter(
      (value): value is string => value !== undefined
    )
  );
  // reject conflicting durable version sources
  if (versions.size > 1) {
    throw new Error("Published app run has conflicting version metadata");
  }
  // return the one durable version source
  if (versions.size === 1) {
    return [...versions][0];
  }
  // restrict log fallback to historical titles
  if (publish.run.displayTitle !== "Publish apps") {
    throw new Error("Published app run has no canonical version metadata");
  }
  return await getLegacyJobVersion(publish, apiBase, token, fetchImpl);
};

// return the version from the most recent successful store publication step
export const getPublishedAppVersion = async ({
  fetchImpl = fetch,
  repository,
  token,
}: PublishedVersionOptions): Promise<string> => {
  // prevent repository path injection
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("GitHub repository must be an owner/name pair");
  }
  // require actions read credentials
  if (token.trim() === "") {
    throw new Error("GitHub token is required");
  }
  const apiBase = `https://api.github.com/repos/${repository}`;
  const runValues = await fetchPages(
    `${apiBase}/actions/workflows/${WORKFLOW_FILE}/runs?status=completed`,
    "workflow_runs",
    token,
    fetchImpl
  );
  // sort run upper bounds before inspecting jobs
  const runs = runValues
    .map(parseRun)
    .sort((left, right) => right.updatedAt - left.updatedAt);
  let latestCompletedAt: number | undefined;
  let latestPublishes: SuccessfulPublish[] = [];
  // inspect runs until their upper bound cannot contain a newer publish
  for (const run of runs) {
    // stop after all potentially newer runs are inspected
    if (latestCompletedAt !== undefined && run.updatedAt < latestCompletedAt) {
      break;
    }
    const publishes = await findSuccessfulPublishes(
      run,
      apiBase,
      token,
      fetchImpl
    );
    // retain only steps at the latest actual publication time
    for (const publish of publishes) {
      // skip older successful steps
      if (
        latestCompletedAt !== undefined &&
        publish.completedAt < latestCompletedAt
      ) {
        continue;
      }
      // replace candidates after finding a newer successful step
      if (
        latestCompletedAt === undefined ||
        publish.completedAt > latestCompletedAt
      ) {
        latestCompletedAt = publish.completedAt;
        latestPublishes = [];
      }
      latestPublishes.push(publish);
    }
  }
  const versions = new Set<string>();
  // resolve version evidence only for the latest publications
  for (const publish of latestPublishes) {
    const version = await resolvePublishVersion(
      publish,
      apiBase,
      token,
      fetchImpl
    );
    // enforce canonical two-part marketing versions
    if (!VERSION_EXACT_PATTERN.test(version)) {
      throw new Error("Published app version is not canonical");
    }
    versions.add(version);
  }
  // require one version across simultaneous platform publications
  if (versions.size !== 1) {
    throw new Error("Latest published app version is missing or ambiguous");
  }
  return [...versions][0];
};
