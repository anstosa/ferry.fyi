# Reliability and trust operations

This runbook defines the repository-owned controls that keep Ferry FYI stable,
truthful, private, and useful to people, search crawlers, and automated agents.
Repository validation never substitutes for production observation.

## Control matrix

| Track | Disposition | Repository evidence | Production/operator evidence |
| --- | --- | --- | --- |
| Build and CI determinism | Implemented | `.github/workflows/check.yml`, `scripts/assert-client-budgets.mjs`, `yarn lint`, `yarn type-check`, `yarn test`, `yarn build` | Review the first five successful hosted runs; blocking-workflow p95 target is 15 minutes. |
| Public deployment smoke | Implemented | `scripts/smoke-public-contracts.mjs` and deployment ordering in `.github/workflows/deploy-aws.yml` | Retain the versioned smoke receipt for each deployment. |
| API compatibility and errors | Implemented | `server/lib/httpApiPolicy.ts`, `tests/server/api.test.ts`, `tests/server/server-security.test.ts` | Inspect deployed unknown/auth/error responses without sending credentials. |
| CORS and abuse controls | Implemented | Endpoint-class policy and rate inventory in `server/lib/httpApiPolicy.ts`; focused server tests | Confirm configured trusted origins and shared-NAT behavior before lowering limits. |
| Browser/PWA cache privacy | Implemented | `client/service-worker.ts`, `tests/client/service-worker-api-cache.test.ts` | Verify Cache Storage contains no authenticated, ticket, account, admin, or live snapshot responses. |
| Lifecycle and readiness | Implemented | `server/lib/serverLifecycle.ts`, `server/lib/serverRuntime.ts`, lifecycle/runtime tests | Synthetic `/readyz` is observational for the default Cloudflare-tunnel topology; it does not remove traffic. |
| Infrastructure safety and recovery | Implemented in repository | Terraform assertions and deployment recovery capture; encrypted RDS, backup retention, final snapshots, immutable image tags, and OTA pointer rollback were already satisfied | Apply reviewed Terraform, verify deletion protection/backups, and run an isolated restore drill. |
| Security response policy | Implemented, staged | `server/lib/httpSecurity.ts`, security tests; CSP remains Report-Only | Configure a privacy-reviewed CSP collector before activation; inspect reports before considering enforcement. |
| Search discovery and SEO truth | Implemented / already satisfied | robots, sitemap, canonical and shared significant-content revision tests; `docs/seo-operations.md` | Inspect canonical/sitemap state in Google Search Console and Bing Webmaster Tools. |
| AI-agent and API discovery | Implemented | `shared/contracts/publicApiOperations.ts`, generated `client/static/openapi.json`, `client/static/llms.txt`, contract checks | Sample the served documents after deployment and retain response hashes. |
| Accessibility and deterministic performance | Implemented with explicit manual gap | focused Playwright checks, bundle budgets, canonical browser-performance receipt validator | Automated checks are not a WCAG claim. Complete the manual checklist and review field CWV only with sufficient traffic. |
| Observability, objectives, and incident evidence | Implemented measurement path; objectives proposed | typed privacy boundary, pure formulas, redacted fixtures, summary script | Activate exports/monitors and collect complete windows before claiming attainment. |

## Baseline

Baseline captured on 2026-08-04 from the pre-change production branch:

- `yarn lint`: passed.
- `yarn type-check`: passed.
- `yarn build`: passed, including PWA and SSR artifact smoke checks.
- `yarn test`: 188 files and 1,024 tests passed; three isolated tests timed out and one worker failed to start during the resource-heavy full run. Each timed-out test is rerun independently during final verification. This is a capacity/flakiness baseline, not an accepted correctness failure.
- The canonical browser-performance harness remains the comparison authority. It requires an audited baseline commit and writes privacy-checked receipts; it is scheduled/manual rather than a per-commit gate.

Builds used for validation must set `SENTRY_AUTH_TOKEN` to an empty value so
local or CI verification cannot publish source-map artifacts.

Baseline exception: the first local baseline build inherited an available
`SENTRY_AUTH_TOKEN` before that guard was applied. The Sentry plugin contacted
organization `ferry-fyi`, project `web`, release `web@DEVELOPMENT`, bundle
`3fff4b29-5c03-5a14-bff4-d8c886f1a1fc`; it reported “Nothing to upload, all
files are on the server” and then successful processing. No deploy occurred and
no Sentry cleanup was attempted. An authorized Sentry operator may inspect that
release's artifact-bundle audit trail and retain the result as evidence; stop
before deletion unless the owner explicitly authorizes it. Every subsequent
build in this work set the token to an empty value.

## Cache and sensitivity classification

| Class | Policy |
| --- | --- |
| Fingerprinted assets | `public, max-age=31536000, immutable` |
| Public discovery documents | short shared freshness, validators, and bounded revalidation |
| Live public API and live SSR | `no-store` unless a route-specific test proves bounded stale behavior is truthful |
| Private, authenticated, account, ticket, admin, check-in, and mutations | `no-store`; never service-worker cached |
| OTA immutable and pointer documents | Preserve `docs/ota-operations.md`; do not apply generic API policy |

Unknown `/api` routes historically fell through to the browser document. That
behavior is recorded only as a regression fixture and is intentionally replaced
by the deterministic JSON API boundary.

## CI gate quarantine

A blocking check may move to scheduled/manual execution only when the same
change includes a rationale, issue/reference, owner, expiry date, and preserved
non-blocking execution. Rerunning a flaky check is not remediation. Budget
changes require a checked-in rationale and before/after artifact measurements.

## Accessibility acceptance record

Automated Axe checks cover the built home and one directional schedule and
block serious/critical WCAG 2.0/2.1 A/AA regressions. They are not a conformance
claim. Before a public release with relevant UI changes, manually record:

- keyboard order, visible focus, modal/menu focus restoration, and escape paths;
- screen-reader names, headings, landmarks, live status announcements, and
  critical schedule/ticket/camera flows;
- meaningful image alternatives and decorative-image suppression;
- 200% zoom/reflow without lost controls or information;
- reduced-motion behavior;
- light/dark contrast in loading, stale, offline, error, and disabled states.

Broader cameras, fares, tickets, offline/failure, native scanning, and alternate
host checks remain scheduled/manual because deterministic automation cannot
validate device permissions, reading order quality, or user comprehension.

## Operational signals

### Inputs and privacy boundary

- HTTP events originate from completed origin requests and contain only schema
  version, normalized route class, method class, status class, duration,
  completion outcome, and release.
- Scheduled-operation events contain only operation name, normalized state,
  timestamps, cadence, and lag category.
- Raw URLs, queries, headers, credentials, cookies, user IDs, ticket IDs, exact
  locations, and request/response bodies are forbidden.
- Production HTTP evidence may be exported from the
  `/ecs/ferry-fyi-prod/web` CloudWatch log group. Tests use redacted fixtures.

### Exact formulas

- Synthetic availability = semantically successful attempts / all scheduled
  attempts. `/readyz` availability is reported separately.
- Planned maintenance is excluded only when declared before the window.
- Missing samples are failures unless an independently evidenced monitoring
  outage exists. A window is reportable only at 95% scheduled-sample coverage.
- Latency p50/p95/p99 uses completed origin requests per normalized route
  class. Failed and incomplete requests are counted separately.
- 5xx and 429 rates use eligible requests within each route class as the
  denominator. Aggregate rates are non-authoritative.
- Source age is retrieval time minus a valid, non-future source timestamp.
  Null, unavailable, malformed, and future timestamps are invalid/unavailable,
  never numeric ages.
- Scheduled-operation lag distinguishes never-run, running, succeeded, failed,
  stale lease/status, and overdue.

### Proposed objectives

The following are proposals, not attained claims:

- 99.9% canonical synthetic availability over 30 days.
- 99.9% readiness availability over 30 days.
- Route-class latency and source-age thresholds remain characterization metrics
  until 14 complete days establish a baseline and an operator accepts them.
- Field CWV objectives are p75 LCP <= 2.5 s, INP <= 200 ms, and CLS <= 0.1
  only for cohorts with at least 200 eligible page views in 28 days.
- Hydration events remain diagnostic because sampled failures do not provide a
  complete success denominator.

## Incident triage and recovery

1. Identify the affected normalized route/operation class and release marker.
2. Separate origin failures, readiness failures, source-data invalidity, rate
   limiting, and incomplete telemetry.
3. Stop rollout when semantic smoke fails, the intended task revision is not
   serving, private responses are cacheable, or API success compatibility changes.
4. Use the captured prior task definitions and immutable image digests only
   after confirming the deployed migration range is backward compatible with
   both revisions. Otherwise prefer a forward fix or an approved database
   recovery path.
5. Roll the detector independently from the web service.

Automatic ECS rollback remains disabled because migrations precede application
deployment and the repository has no enforceable expand/contract attestation.

## External-only operator handoffs

### Apply infrastructure changes

- Prerequisites: reviewed Terraform plan, AWS credentials, maintenance owner,
  captured current task definitions and image digests.
- Action: apply the reviewed plan and observe ECS stability plus semantic smoke.
- Evidence: plan/apply logs, task revisions, image digests, smoke receipt.
- Rollback: only after migration compatibility review; otherwise forward-fix.
- Stop: unexpected resource replacement, migration ambiguity, or failed smoke.

### Database restore drill

- Prerequisites: authorized AWS/RDS access, a maintenance owner, an isolated DB
  subnet group/security group with no production ingress, an isolated
  application task definition, and approved cleanup authority. Set
  `PROD_DB_ID`, `ISOLATED_DB_SUBNET_GROUP`, and
  `ISOLATED_DB_SECURITY_GROUP`; stop if any value is ambiguous.
- Verify protection and backup state before creating anything:

  ```sh
  aws rds describe-db-instances --db-instance-identifier "${PROD_DB_ID}" \
    --query 'DBInstances[0].{DeletionProtection:DeletionProtection,BackupRetentionDays:BackupRetentionPeriod,LatestRestorableTime:LatestRestorableTime,PubliclyAccessible:PubliclyAccessible}'
  aws rds describe-db-instance-automated-backups \
    --db-instance-identifier "${PROD_DB_ID}" \
    --query 'DBInstanceAutomatedBackups[0].{Status:Status,Earliest:RestoreWindow.EarliestTime,Latest:RestoreWindow.LatestTime}'
  ```

  Require deletion protection `true`, positive retention, backup status
  `active`, and a current nonempty restore window.
- Restore using an unmistakably temporary identifier and private isolation:

  ```sh
  RESTORE_ID="${PROD_DB_ID}-restore-drill-$(date -u +%Y%m%d%H%M%S)"
  aws rds restore-db-instance-to-point-in-time \
    --source-db-instance-identifier "${PROD_DB_ID}" \
    --target-db-instance-identifier "${RESTORE_ID}" \
    --use-latest-restorable-time \
    --db-subnet-group-name "${ISOLATED_DB_SUBNET_GROUP}" \
    --vpc-security-group-ids "${ISOLATED_DB_SECURITY_GROUP}" \
    --no-publicly-accessible --no-multi-az
  aws rds wait db-instance-available --db-instance-identifier "${RESTORE_ID}"
  ```

- Start only the approved isolated application task with its database secret
  pointing at `${RESTORE_ID}`; it must have no production load balancer,
  scheduler, notifications, refresh jobs, or public DNS. Do not run migrations
  unless separately approved. Run `scripts/smoke-public-contracts.mjs`
  against that isolated application's private test endpoint and retain its
  receipt.
- After evidence review, delete the temporary instance and prove cleanup:

  ```sh
  aws rds delete-db-instance --db-instance-identifier "${RESTORE_ID}" \
    --skip-final-snapshot
  aws rds wait db-instance-deleted --db-instance-identifier "${RESTORE_ID}"
  ```

- Evidence: instance/backup query outputs, restore identifier and timestamps,
  isolation rule/subnet identifiers, isolated task revision, smoke receipt,
  deletion result, and named operator.
- Stop: deletion protection/retention/restore window is wrong, the target could
  accept production traffic, credentials are shared beyond the isolated task,
  migrations are required but unapproved, semantic smoke fails, or cleanup
  cannot be verified.

### CSP reports and external monitoring

- Prerequisites: privacy review covering URL/query redaction, sampling,
  retention, access control, alert destinations, and rate limiting.
- Action: configure Report-Only collection and synthetic monitoring.
- Evidence: redacted sample, dashboard/query definitions, measurement window.
- Rollback: remove reporting endpoint/header; CSP is not enforced by this program.
- Stop: sensitive values appear or sampling/retention boundaries are not enforced.

### Verify Cloudflare cache and security headers

- Prerequisites: read-only Cloudflare zone access, the deployed smoke receipt,
  and the intended release/task-definition identifier. Use anonymous requests
  only; never attach cookies, bearer tokens, or ticket identifiers.
- Action: request each discovery document twice and record response headers;
  request one live API path, one canonical SSR page, one unknown API path, and
  one fingerprinted asset. Confirm discovery has bounded five-minute shared
  freshness and validators, live/API/error responses are `no-store`, assets
  are immutable, the security baseline is present, and Cloudflare does not
  cache private/live/error classes. Record `CF-Cache-Status`, `Age`, `ETag`,
  `Cache-Control`, `CDN-Cache-Control`, `Surrogate-Control`, `Vary`, and the
  staged CSP/HSTS headers without recording response bodies containing live
  data.
- Expected evidence: timestamped redacted header captures for every class,
  active Cloudflare cache-rule export, release/task revision, and a comparison
  against the repository cache matrix.
- Rollback: disable the conflicting Cloudflare cache/header rule and purge only
  affected public discovery paths; do not purge or cache private responses as
  a workaround.
- Stop: any authenticated/private/live/error response is cached, discovery is
  cached beyond the bounded policy, the observed release differs, or a header
  rule weakens origin security policy. Treat this as a rollout blocker.

### Activate runtime dashboards and alerts

- Prerequisites: read-only access to CloudWatch log group
  `/ecs/ferry-fyi-prod/web`; a privacy-approved 30-day evidence bucket; and
  an operator-owned, tested alert destination recorded as
  `FERRY_FYI_OPS_ALERT_DESTINATION`. Stop if the destination has no named
  owner or acknowledgement test.
- HTTP export: in CloudWatch Logs Insights, select only
  `event=public_http_request` records and extract exactly
  `schemaVersion`, `event`, `routeClass`, `methodClass`,
  `statusClass`, `durationMs`, `release`, and
  `completionOutcome`. Export one JSON object per line. Do not export
  `@message`, raw request fields, URLs, queries, headers, or adjacent log
  context. Run:

  ```sh
  yarn summarize:runtime-observability --logs redacted-http.jsonl \
    --synthetics synthetic-window.json --output runtime-summary.json
  ```

- Synthetic window: run the final public-contract smoke every five minutes.
  Record the total scheduled attempts separately from received receipts,
  planned maintenance only when declared before the window, and monitor
  outages only with independent monitor evidence. Retain the immutable smoke
  receipts and the input bundle used by the summary.
- Dashboard panels: canonical availability, readiness availability, coverage
  and missing attempts; p50/p95/p99 by normalized route class; class-level 5xx
  and 429 rates; source-age outcomes; and scheduled-operation outcome counts.
  Aggregate traffic is context only and cannot replace any class panel.
- Initial alert conditions: any semantic-smoke failure; any readiness failure;
  any coverage below 95%; any class with a nonzero 5xx rate in two consecutive
  five-minute windows; any unexpected 429 on `api.anonymous-read`; any stale,
  failed, never-run, or overdue scheduled operation. Route alerts to the tested
  `FERRY_FYI_OPS_ALERT_DESTINATION`.
- Measurement window: retain daily summaries, but do not claim the proposed
  30-day availability objectives until one complete 30-day window is
  reportable. Latency/source-age thresholds require 14 complete days and an
  operator-approved threshold. Field CWV requires 200 eligible page views per
  route/device cohort in 28 days.
- Expected evidence: the redacted JSONL export, synthetic input manifest,
  `runtime-summary.json`, CloudWatch query text/time range, dashboard export,
  alert rule export, delivery/acknowledgement proof, release markers, and named
  owner.
- Rollback: disable only the new alert/query/export configuration; application
  request handling is independent of dashboard activation.
- Stop: any sensitive key/value, raw URL/query, incomplete time window,
  coverage below 95%, untested destination, or mismatch between receipt release
  and observed release. Such a window is invalid evidence, not attainment.

The Report-Only policy must continue to account for the inline bootstrap and
first-paint styles, JSON-LD, Vite assets, Mapbox workers/blob URLs, Auth0,
Firebase messaging, Sentry, analytics/tag-manager endpoints, fonts, images,
native web views, and PWA service-worker behavior. These are enforcement
blockers, not permission to broaden an enforced policy. Production does not
activate the Report-Only header until `CSP_REPORT_URI` is a validated HTTPS URL
and the collector satisfies the privacy controls above.

### Search and field-performance consoles

- Prerequisites: verified site ownership and a deployed public-contract receipt.
- Action: inspect/submit sitemap and canonicals in Google and Bing; review CrUX,
  Search Console, or existing Sentry field evidence.
- Evidence: dated screenshots/exports and traffic sufficiency.
- Stop: do not report lab results or insufficient samples as field attainment.
