# Google Routes operations

This runbook describes the external launch gates for the sailing-recommendation
route-time provider. Repository code and Terraform are scaffolding only: they do
not prove that Google billing, alert policies, the email recipient, Workload
Identity Federation (WIF), or the Routes API key are configured.

## Runtime configuration

Keep development and production in separate Google projects with separate
server-side keys. The AWS app-config secret must contain:

- `GOOGLE_ROUTES_ENABLED`: the server-only kill switch; keep it `false` until
  every gate below passes.
- `GOOGLE_ROUTES_API_KEY`: a server-only key restricted to the Routes API.
- `GOOGLE_PLACES_ENABLED`: the server-only address-autocomplete kill switch;
  keep it `false` until the optional Places gates below pass.
- `GOOGLE_PLACES_API_KEY`: a separate server-only key restricted to Places API
  (New). Never expose this key to the browser or native client.

Before applying the Terraform task-definition changes, add the four runtime
keys to the existing app-config JSON: `GOOGLE_ROUTES_ENABLED="false"`,
`GOOGLE_ROUTES_API_KEY=""`,
`GOOGLE_PLACES_ENABLED="false"`, and `GOOGLE_PLACES_API_KEY=""` are
safe disabled values. ECS cannot pull a referenced JSON key that is absent;
a missing key would block task startup even though the runtime feature defaults
off. Secret changes and enabling remain operator-owned external actions.

Terraform includes both Places keys in the default `app_secret_keys` list.
`app_secret_keys` overrides only select keys that already exist;
they do not create secret values. Preserve every existing mapping when adding
the two Places mappings to an override, and do not apply before both JSON keys
exist or healthy tasks can fail to start.

Local Compose forwards the disabled flag and server-only Places key for local
testing. Keep the local safety overlay disabled by default. A locally available
key does not prove production readiness and does not authorize production API,
billing, key, quota, alert, or secret changes.

Local Google credentials may be held in
`${HOME}/.config/ferry-fyi/google-maps.env` (directory `0700`, file `0600`) and
sourced by the ignored `.envrc`. They are forwarded only to the Compose server,
not the client container or browser build. Do not put actual key values in
tracked configuration or command arguments.

Terraform injects these non-secret WIF settings only when
`google_routes_operations_enabled=true`:

- `AWS_REGION`
- `GOOGLE_MONITORING_PROJECT_ID`
- `GOOGLE_WORKLOAD_IDENTITY_PROVIDER`, in full
  `//iam.googleapis.com/projects/.../locations/global/workloadIdentityPools/.../providers/...`
  form.

ECS supplies `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`. The runtime accepts only
`/v2/credentials/<identifier>` and always reads it from the fixed
`http://169.254.170.2` task-credentials host. Do not add a Google service-account
key, AWS access key, arbitrary metadata URL, or token logging.

## Accepted key posture

Ansel selected the existing ECS networking design. It has task public IPs and no
stable NAT egress. Therefore:

1. Restrict each Routes key to the Routes API only.
2. Restrict each separate Places key to Places API (New) only.
3. Set the project quotas to 60 Compute Routes requests per minute and 60
   Places Autocomplete requests per minute.
4. Rotate keys at most every 90 days and immediately after possible exposure.
5. Keep secrets and request origins out of logs, traces, errors, and fixtures.
6. Record that the absent source-IP restriction is an accepted weaker control;
   it is not equivalent to API plus IP restriction.

Do not add a NAT gateway, Elastic IP, proxy, or dynamic task-IP mutation under
this design.

## Places address autocomplete

Enable `places.googleapis.com` in the same environment-specific Google project
as Routes only after the cost and notification gates below are ready. The app
proxies Autocomplete (New) through
`/api/sailing-recommendations/address-suggestions`; the browser never calls
Google or receives the Places key. The proxy sends an HTTPS `POST` to
`https://places.googleapis.com/v1/places:autocomplete`, requests only place
predictions, uses US response formatting and ranking, and returns only the text
and place identifier needed for the dropdown and selected origin. A location bias may prefer nearby results but must not
be treated as a geographic restriction.

The client waits for at least three characters and debounces input by 350 ms.
This implementation deliberately sends no Places session token and makes no
Place Details request. Selecting a prediction displays its normalized address
and submits its opaque place ID as the ephemeral Routes origin. Editing the
selected text clears that identifier and restores manual-address routing.
Routes does not terminate a Places session. Every Autocomplete request is
therefore billed under `Autocomplete Requests`, including abandoned searches.
Do not describe the requests as free session usage or add a token without also
adding a valid termination request and revising the cost model.

The current global allowance is 10,000 `Autocomplete Requests` billable events
per calendar month, followed by the published per-request overage price. Verify
the current [Places pricing][places-pricing] before launch. Debouncing reduces
calls but is not a billing boundary, so the 60-request-per-minute project quota,
persistent attempt counter, and alerts remain required.

Autocomplete suggestions displayed without a Google map must include visible
`Google Maps` attribution in the same dropdown container. Prefer Google's
official logo; when space requires text, use exactly `Google Maps`, keep it on
one line, do not localize or alter it, use normal 400-weight sans-serif text at
12–16sp, and maintain accessible contrast. The public Ferry FYI terms and
privacy pages must link to the [Google Maps Platform Terms][google-maps-terms]
and [Google Privacy Policy][google-privacy], respectively. Do not cache or store
typed input or suggestion content; keep the selected address and identifier ephemeral and out
of logs, traces, errors, analytics, and fixtures.

Autocomplete diagnostics contain only fixed failure stages, availability and
aggregate duration. Diagnostic sink failures cannot replace the normalized
suggestion response. The ECS credential read, Google token exchange and
Monitoring write each have a ten-second network deadline, including credential
and token response-body reads, so a stalled provider cannot hold an export lease
indefinitely.

Run `yarn db:migrate` before enabling Places. Migration
`20261003000300-allow-autocomplete-usage` extends the existing usage-SKU constraint
without changing historical counters. Its rollback refuses to discard retained
Autocomplete aggregates; it fails atomically if those rows still exist.

[places-setup]: https://developers.google.com/maps/documentation/places/web-service/get-api-key
[places-autocomplete]: https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
[places-pricing]: https://developers.google.com/maps/billing-and-pricing/pricing#places-pricing
[places-policies]: https://developers.google.com/maps/documentation/places/web-service/policies
[google-maps-terms]: https://cloud.google.com/maps-platform/terms
[google-privacy]: https://policies.google.com/privacy

The setup, request shape, pricing, storage, and attribution requirements above
come from the official [Places setup][places-setup],
[Autocomplete (New)][places-autocomplete], and
[Places policies][places-policies] documentation.

## Estimated free-usage gauges

The app keeps Pacific-billing-month counters by SKU. It increments attempts
before network I/O, counts every HTTP 2xx as success even if the body is empty or
malformed, and counts a received non-2xx as a known failure for diagnostics.
The conservative alert/export estimate includes every attempt, including failures,
network errors, timeouts and process loss. HTTP failure alone does not prove a
request is nonbillable; Google documents billable error classes in its
[reporting guidance](https://developers.google.com/maps/reporting-and-monitoring/reporting).
This may overestimate actual billing rather than suppress a cost notification.

Every five minutes the owner operation publishes three zero-capable gauge
series under the existing metric:

`custom.googleapis.com/ferry_fyi/google_routes/month_to_date_estimated_requests`

The only label is `sku`, with values `compute_routes_essentials`,
`compute_routes_pro`, and `autocomplete_requests`. The payload contains only the
SKU and count. It never contains an origin, request ID, terminal, account, or
rider identifier. Publishing a zero for all three new-month series after
midnight Pacific closes prior-month incidents and provides a heartbeat. Keep
the legacy `google_routes` metric path so existing dashboards and permissions
continue to apply.

Configure six Cloud Monitoring strict-Above policies:

| SKU                   | Approximate allowance | Alert threshold |
| --------------------- | --------------------: | --------------: |
| Essentials            |         80% of 10,000 |       `> 7,999` |
| Essentials            |        100% of 10,000 |       `> 9,999` |
| Pro                   |          80% of 5,000 |       `> 3,999` |
| Pro                   |         100% of 5,000 |       `> 4,999` |
| Autocomplete requests |         80% of 10,000 |       `> 7,999` |
| Autocomplete requests |        100% of 10,000 |       `> 9,999` |

Use `duration="0s"` for no retest window and omit
`notificationChannelStrategy` for no renotification. Omit
`evaluationMissingData`: Google ignores that setting for zero-duration
conditions, so it cannot establish a non-violating missing-data policy. Verify
the five-minute zero heartbeat and Pacific month reset instead. Use a
300-second `ALIGN_MAX` alignment for these integer gauges, matching the
five-minute sampling interval. The month reset can take the alignment window
plus Monitoring processing time to resolve an incident. See the official
[alert-policy API][alert-policy-api] and [alignment guidance][alignment-guidance].

Link all six policies to the named operator email channel. Ansel selected both
opening and resolved emails: set
`alertStrategy.notificationPrompts=["OPENED", "CLOSED"]`. Leave renotification
disabled. Email channels can omit `verificationStatus` when Google does not
require verification; a saved channel is not proof of delivery.

Test using a distinct temporary custom metric and cloned policies; the test
metric may be in the same project. Never drive the production gauge to a
threshold. Send above-threshold test samples followed by zero samples, verify
the incidents open and close, and obtain actual recipient acknowledgement for
each policy's opening and resolved emails. API success alone is not delivery
proof. Delete only the owned temporary policies and metric descriptor after
testing; deleting the descriptor makes retained test data inaccessible rather
than immediately deleting the samples. See [notification-channel testing][channel-testing]
and [custom-metric deletion][metric-deletion].

These gauges estimate this app's traffic. Google's free allowance is pooled by
SKU across all projects on the billing account. Before launch, inventory every
linked project and prove that there is no other same-SKU traffic, isolate the
billing account, or add an account-wide reconciliation source. Otherwise launch
is blocked; do not claim that these emails represent exact billing usage.

Custom metric ingestion and Monitoring use can themselves be chargeable. Neither
the app estimate nor the policies stop requests or spending.

## AWS WIF binding

Terraform creates a dedicated web ECS task role and leaves the detector on the
existing task role. Bind the Google AWS provider to the account and role name
from the exact `web_task_role_arn` Terraform output. AWS returns an STS assumed
role ARN, not that IAM role ARN. Use these mappings:

```text
google.subject=assertion.arn
attribute.aws_role=assertion.arn.extract('assumed-role/{role_name}/')
```

Restrict the condition to
`assertion.account == '<aws-account-id>' && attribute.aws_role == '<web-role-name>'`
and grant only the pool's
`principalSet://iam.googleapis.com/projects/<google-project-number>/locations/global/workloadIdentityPools/<pool>/attribute.aws_role/<web-role-name>`
principal `roles/monitoring.metricWriter` on the Monitoring project. See
[AWS federation][aws-federation].

The runtime signs AWS STS `GetCallerIdentity` with built-in Node cryptography,
exchanges it for `monitoring.write`, and caches the short-lived token only until
shortly before expiry. Before launch, execute a preproduction
`projects.timeSeries.create` smoke using the deployed web role. Confirm that the
detector role and any other AWS principal cannot write the metric.

## Reported net USD 1 alert

Create a separate Cloud Billing budget with:

- calendar-month period;
- USD 1 amount;
- exactly one 100% **Actual** (`CURRENT_SPEND`) threshold;
- applicable savings, free-tier credits, and other credits included;
- scope limited to the Ferry FYI Routes project and including both Routes and
  Places API (New) charges in the Google Maps Platform service scope exposed by
  the console;
- the same confirmed operator email channel.

Budgets do not offer a Routes SKU filter. Preview the report scope before saving.
The Billing Budgets v1 REST field is `notificationsRule`, not the obsolete
`allUpdatesRule`. Service filters use Cloud Billing Catalog resource names:
Routes `services/0161-1616-FF1D` and Places API (New)
`services/0776-5E2E-55E3`. Retain the actual service resources in evidence rather
than relying on display names. See the [budget API][budget-api].
This alert is for the first **reported net** USD 1, not the exact first paid
request. Credits can delay it, taxes can affect it, and Google billing email can
arrive hours later. It is an alert only and never caps monthly or total spend.

## Redacted readiness evidence

Export redacted configuration evidence to a file outside Git and run:

```bash
node scripts/verify-google-routes-operations.mjs /path/to/redacted-evidence.json
```

The evidence must contain project and billing identifiers, the full linked-project
inventory, all three SKU caps, all six policy settings when Places is requested,
isolated opening-email proof, explicit closure-email behavior, the confirmed
redacted recipient identifier, the USD 1 Actual budget including Places, exact
WIF role binding, preproduction metric smoke, separate key
restriction/rotation/quota posture, public Google terms and privacy links, and
an approved release gate while `GOOGLE_ROUTES_ENABLED` and
`GOOGLE_PLACES_ENABLED` are still false. Places evidence must also prove that
Places API (New) is enabled and that the autocomplete request shape, disabled
fallback, ephemeral handling, and Google Maps attribution were tested without a
real provider request. Never include a key or user-entered address in evidence.
The fixture shape is locked by
`tests/server/google-routes-operations-verifier.test.ts`.

After verification, enable the external WIF Terraform inputs and deploy once.
Run a real ETA smoke for each mode without logging origin data. Only then set
`GOOGLE_ROUTES_ENABLED=true` and deploy again. Roll back by setting it false and
redeploying; schedules remain available without Google Routes. Separately set
`GOOGLE_PLACES_ENABLED=true` only after the optional Places evidence passes with
the release value still false. Do not use a paid Places request to produce
readiness evidence. Roll Places back independently by setting it false.

## Terminal booth review gate

Apply migration `20261003000400-create-terminal-location-settings.js`, then open
the owner admin UI at `/admin?tab=terminals`. Each terminal has two independently
editable coordinate pairs: **booth** for navigation and **dock** for the public
map. Review and save booth coordinates against official terminal access
information before enabling travel estimates. All four travel methods use the
saved booth as their timing destination; there are no mode-specific entrance
overrides. This is arrival timing to that point, not a claim of accessible
pedestrian routing, queue clearance, parking time, or boarding eligibility.

An unset booth or failed booth lookup returns `configuration-unavailable`
without calling Google. A dock or generic WSF terminal center is never used as
a booth fallback. The owner-confirmed points persist separately from WSF data,
and navigation reads the current database booth on every request across server
instances. Saving a point does not enable Google or bypass billing/alert gates.

`GOOGLE_ROUTES_TERMINAL_ACCESS_POINTS` is obsolete and is no longer injected or
read by the application. A legacy value left in an existing private secret does
not affect routing and need not be deleted during this rollout. Riders cannot
override destinations. Lines outside the toll booth are not included. Estimates
do not guarantee boarding.

[alert-policy-api]: https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.alertPolicies
[alignment-guidance]: https://docs.cloud.google.com/monitoring/alerts/concepts-indepth#best-practices
[channel-testing]: https://docs.cloud.google.com/monitoring/support/notification-options#test-channel
[metric-deletion]: https://docs.cloud.google.com/monitoring/custom-metrics/creating-metrics#delete-metric
[aws-federation]: https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-clouds#aws
[budget-api]: https://docs.cloud.google.com/billing/docs/reference/budget/rest/v1/billingAccounts.budgets
