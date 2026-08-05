# Owner admin operations

This guide describes the current owner-only operational controls. The admin UI
is a convenience layer, not an authorization boundary. Treat `/api/admin/*` as
an internal application API rather than a third-party integration.

## Access and confirmation

Every admin route requires a valid Auth0 bearer token and a server-side Auth0
lookup confirming that its subject belongs to Ferry FYI's single configured
owner. Authentication, ownership lookup, or ownership mismatch failures deny
access. Client-side menu or route visibility does not grant access. Admin
responses use `Cache-Control: no-store`.

Mutations require an action-specific typed confirmation. The server derives the
canonical target from the trusted route resource and accepts only the normalized
phrase `CONFIRM <action> <target>`. A client cannot choose another target or
replace the phrase with a boolean. The server removes the phrase before calling
the domain handler and does not store or log it.

Use the admin UI to obtain the exact target and confirmation prompt. Do not
reuse a confirmation intended for one user, operation, or content item on
another target.

## Feature delivery and manual check-ins

The `leaderboards` flag is persisted in the database. Its evaluation order is:

1. An active kill switch denies the feature for everyone.
2. Otherwise, a globally enabled flag permits it for everyone.
3. Otherwise, an explicit authenticated Auth0 subject allowlist may permit it
   for supported subject-aware features.
4. Otherwise, the feature is unavailable.

Public pages and public API decisions use global state only; a subject allowlist
never makes a feature public. There is no percentage rollout or expiry.

Automatic and background leaderboard check-ins are unavailable. The server
always reports that capability as disabled, and the admin feature endpoint
cannot enable it. Check-ins require an open-app, foreground interaction.

## User data and sign-out

### Delete Ferry FYI user data

Deleting a user removes Ferry FYI-owned identifying state in one database
transaction, including user settings, feature allowlist entries, leaderboard
profile data, and terminal-presence state. Retained leaderboard check-in/score
records are reassigned to a newly generated, non-linkable anonymous subject so
aggregate scores remain usable. This is irreversible.

The deletion does **not** delete, disable, or otherwise modify the person's
Auth0 identity. A later Auth0 sign-in can therefore create fresh Ferry FYI
state.

### Force sign-out

Force sign-out immediately writes a bounded application-token revocation
watermark. Authenticated API routes reject tokens issued at or before that
watermark. The record contains an HMAC of the Auth0 subject rather than the
subject itself and expires after the maximum accepted application token
lifetime (24 hours by default; `APPLICATION_TOKEN_MAX_AGE_SECONDS` can change
that lifetime).

The operation also attempts Auth0 Management API revocation for device
credentials and tenant-supported sessions. Its result names each capability as
`complete` or `unavailable`, with an overall `complete` or `partial` status.
A partial result means Ferry FYI application tokens were revoked but one or
more Auth0 operations could not be completed. It never claims to end an Auth0
SSO session.

## Data operations

The Data operations screen lists every current maintenance operation. It shows
what the operation changes, its usual trigger, and its most recently recorded
run. Scheduled-only rows are informational and cannot be started from the
data-health API.

| Operation                                            | Effect                                                                    | Normal trigger                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `camera-line-detection-refresh`                      | Refreshes camera line-detection results used by camera views.             | Every minute at `:30`; also deferred after web server startup.                   |
| `clear-wsf-memory-cache`                             | Clears the in-memory schedule cache while preserving core route data.     | Daily at 04:00 server time.                                                      |
| `demand-events-refresh`                              | Refreshes school-break and major-sports forecast inputs.                  | Daily at 04:20; also deferred after web server startup.                          |
| `fare-catalog-refresh`                               | Warms current ferry-day and due fare catalogs.                            | Hourly at `:15`, daily at 00:05 America/Los_Angeles, and deferred after startup. |
| `leaderboard-rebuild`                                | Rebuilds leaderboard aggregates from retained check-ins.                  | Manual only.                                                                     |
| `schedule-refresh`                                   | Refreshes WSF sailing schedules and schedule cache data.                  | Daily at 04:05 server time.                                                      |
| `tide-forecast-refresh` / `weather-forecast-refresh` | Forces forecast inputs used by route forecasting.                         | Best-effort after short WSF refreshes, rate-limited by the environment.          |
| `wsf-daily-refresh`                                  | Runs daily WSF route-to-vessel inference.                                 | Daily at 04:10 server time.                                                      |
| `wsf-long-refresh`                                   | Refreshes WSF cameras, vessels, routes, and terminals.                    | Every 5 minutes.                                                                 |
| `wsf-refresh`                                        | Runs full WSF long/status/schedule refresh without notification dispatch. | Non-notifying fallback startup and manual runs.                                  |
| `wsf-short-refresh`                                  | Refreshes WSF vessel status and capacity without notifications.           | Every minute only in non-notifying fallback mode.                                |
| `wsf-short-notifying-refresh`                        | Refreshes vessel status/capacity and sends eligible notifications.        | Every minute on the singleton web process; scheduled only.                       |
| `wsf-notifying-refresh`                              | Performs full WSF cache warmup with notification-capable status refresh.  | Web server startup; scheduled only.                                              |

An operation has one persisted current-status row, not an execution history.
States are `idle`, `running`, `succeeded`, or `failed`, with sanitized result or
error text and timing/lease fields. A run holds a 15-minute database lease.
Another request for a non-expired run returns the current state instead of
starting duplicate work; a stale lease can be recovered. The lease token
prevents a stale worker from overwriting a newer run's result.

The WSF operations intentionally share a single lease/status row so overlapping
startup, scheduler, and manual work cannot run at the same time. Their displayed
last-run timestamp therefore reflects the latest shared WSF activity, not a
separate per-job execution history.

Do not add shell commands, URLs, SQL, arbitrary cache keys, or unregistered
jobs to this surface. Add a named registry entry, bounded domain implementation,
and focused tests instead.

## Notification pause and dashboard

The notification pause is a persisted global policy. The Firebase submission
boundary reads that policy immediately before every provider call, including
queued retries. Once the pause commits, queued or retried messages are
suppressed. A provider call already in flight cannot be recalled.

The dashboard is deliberately limited to:

- global paused state;
- cross-process aggregate queued and in-flight counts; and
- the most recent aggregate request result (`accepted`, `failed`, `paused`, or
  `unavailable`), retained for at most five minutes.

It does not contain message payloads, recipients, provider credentials,
delivery claims, or history. Both the policy and these short-lived aggregate
dashboard values are stored in the database so any web process reads the same
state; they expire after five minutes rather than forming a history.

## Public content and SEO controls

Published announcements and an enabled maintenance notice render as escaped,
server-rendered public notices. Unpublished announcements are not included in
public content. Announcement title and body are plain text, not HTML.

Crawler policy is restricted to the following persisted choices:

- AI crawlers: `allow` or `disallow` for the fixed supported agent list.
- General disallow paths: `/account`, `/admin`, `/callback`, and
  `/leaderboards/settings` only.

`robots.txt`, `sitemap.xml`, and the leaderboard section of `llms.txt` are
served dynamically before `express.static`. Each request reads the persisted
public policy, so a new dyno cannot serve a deploy-time `robots.txt` or sitemap
snapshot. Disabling leaderboard indexing removes leaderboard URLs from the
sitemap and leaderboard material from `llms.txt`, and emits `noindex,follow` on
leaderboard pages. Disabling the public leaderboard feature instead makes those
pages unavailable.

`llms.txt` itself remains source-controlled and has no admin edit endpoint.
The persisted leaderboard sharing setting is returned with public/admin content
state, but this release does not yet consume it in a public sharing route; do
not treat it as an enforcement mechanism until such a route exists.

## Ticket lookup policy

Ticket lookups are initiated only when a ticket is added, when its popup is
opened, or when the user explicitly refreshes that open ticket. Loading the
saved-ticket list does not start a bulk refresh, and there is no refresh-all
operation.

The server serializes Wave2Go lookups globally within each web process and
keeps at most 250 successful results in a shared in-memory cache for 30 minutes.
For a signed-in request, the latest successful result is also persisted by
account and ticket so another device on the same account can reuse it during
that freshness window. Anonymous lookups are not persisted. Cached responses
retain the timestamp of the upstream lookup rather than pretending a new lookup
occurred. This is a current per-account cache, not an operational lookup
history. Removing a saved ticket deletes its persisted result, and owner account
data deletion deletes all persisted ticket results for the subject.

The Ticket lookup admin screen selects one of a fixed set of truthful Ferry FYI
User-Agent profiles. Arbitrary values and browser impersonation are not
available. Saving a profile clears the in-memory result cache; persisted
per-account results retain their original freshness and expire from lookup use
after 30 minutes. If a later upstream refresh is unavailable, the last
successful account-scoped result can still be returned with its original
timestamp. The setting does not bypass a challenge, override upstream policy,
or guarantee access.

## Advertising controls

Advertising uses a persisted global switch plus one switch on each placement.
The global switch overrides every placement. Route placements are keyed by the
ordered departure and arrival terminal ids, so the reverse direction is a
separate placement with separate creative and enabled state. The home placement
has no route direction.

The legacy public ads endpoint is intentionally empty. Server-rendered public
documents may contain the current immutable creative, while mounted clients
request a short-lived exposure envelope before recording measurements. Ad-bearing
documents are not retained in the server document cache, so global and placement
switches take effect on the next request. Disabled and draft creative remains
owner-only. Riders see no empty ad container. The owner may see a dashed
placeholder on the home, schedule, cameras, terminal-details, and fare surfaces
when their matching placement is empty or inactive.

Ad creative is plain text plus one HTTPS destination URL. The server validates
bounded advertiser, headline, body, and destination fields before storage.
Every mutation uses the `save-ad-settings` confirmation action with either the
global `ads:global` target or the exact `ad:<placement-key>` target. The admin
surface does not provide arbitrary HTML, scripts, tracking tags, or image
uploads.

Scheduling creates an immutable campaign snapshot with an ordered placement,
creative, HTTPS destination, start, and end. Overlapping campaigns for one
placement are rejected. Ending a campaign early is irreversible; collected
counters cannot be edited, reset, reassigned, or backfilled through the admin
surface.

Measurement stores daily placement/campaign aggregates for opportunities,
served ads, viewable impressions, and ad clicks. One short-lived hashed
exposure row suppresses duplicate claims and is removed after expiry. It stores
no account subject, visitor/session id, IP address, user-agent history, precise
location, ticket data, or notification state. The global and per-placement ad
switches suppress delivery but not opportunity measurement. The separate
`AD_MEASUREMENT_ENABLED=false` environment switch is incident-only and creates
an explicit prospective measurement gap.

Advertiser report links use `REPORT_BASE_URL`, which must be a report-only host
not claimed by Android App Links. The bearer secret is in the URL fragment,
stored only as a hash, removed from the browser location after load, and valid
until the owner irrevocably revokes it. Report responses are campaign-scoped,
aggregate-only, non-cacheable, non-indexable, and excluded from the main SPA and
analytics. Never put report or exposure secrets in logs, analytics, query
strings, support messages, `llms.txt`, OpenAPI, or sitemap entries.

## Deliberate no-audit policy

This suite does not keep an actor/action audit history. It does not retain typed
confirmation values, notification delivery history, recipients, message bodies,
or an operation run log. The current operation-status row, temporary aggregate
notification status, and short-lived non-identifying token-revocation watermark
exist only to operate the service safely; they are not audit records.

When changing admin behavior, preserve this policy. If a capability needs
forensic history, obtain an explicit product and privacy decision before adding
one.

## Change checklist

When adding or changing an admin capability:

1. Mount it only below the authenticated owner composition root.
2. Require a server-derived typed confirmation for every destructive mutation.
3. Keep automatic/background check-ins unavailable.
4. Route all provider notifications through the final shared policy boundary.
5. Put public crawler, sitemap, and `llms.txt` behavior behind the persisted
   content controls before static-file middleware.
6. Keep draft/disabled advertising creative out of anonymous responses,
   preserve ordered departure/arrival keys, and keep report hosts/secrets out of
   discovery and the main app runtime.
7. Update this guide, `docs/leaderboards.md` when leaderboard behavior changes,
   `client/static/llms.txt` when a public page or AI-useful API changes, and
   focused tests and migrations as applicable.
